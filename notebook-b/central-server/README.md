# B 중앙 서버

Python 3.11 + FastAPI + SQLite. **이 폴더는 노트북 B에서만 실행한다.**
A 녹화 프로그램이나 USB 장치에 직접 접근하지 않고 [공유 API](../../shared/API.md)의 Adapter만 읽는다.

## 구현 상태

- 관리자/신고자/agent Bearer 인증과 신고 소유자별 상태 조회.
- 일반·관리자 모의 신고를 동일한 트랜잭션으로 저장. 서버 재시작 후 신고와 작업 유지.
- A 카메라 동기화, 녹화구간 조회. A 장애 중에도 신고 접수 가능.
- 관리자 위치/승인 등록, 실제/데모 위치 구분, 60초 이내 관측·온라인·승인·반경 조건 후보 조회.
- `CCTV_WORKER_ENABLED=true`이면 GPU worker가 신고→반경 후보→저FPS 탐색→집중 분석→요약을 수행한다. 끄면 작업은 `queued / awaiting_worker`로 남는다.
- A 녹화 추출본을 수신해 SHA256·크기·재생 길이·첫 프레임을 확인하고 사건별로 보존/다운로드한다. 미승인 카메라는 보존하지 않는다.
- 공식 부산 공개 CCTV 장비 좌표 21,009건을 별도 위치 카탈로그 API로 제공한다. 공개 좌표는 영상 접근권한이 아니다.
- YOLO26n + MediaPipe Pose(CUDA), OpenAI 분류·전사·요약(키 없으면 로컬 규칙), 첨부 업로드, 확인·종결, 지표, WebSocket. API는 `shared/API.md`의 v0.2 절.
- 관리자 화면은 `../admin-web`. Expo 앱은 별도 단계다.

## 설치·실행 (저장소 루트 PowerShell)

```powershell
py -3.11 -m venv notebook-b/central-server/.venv
notebook-b/central-server/.venv/Scripts/python.exe -m pip install -r notebook-b/central-server/requirements-dev.lock
notebook-b/central-server/.venv/Scripts/python.exe notebook-b/central-server/setup_tools.py
notebook-b/central-server/.venv/Scripts/python.exe notebook-b/central-server/setup_models.py
Copy-Item notebook-b/central-server/.env.example notebook-b/central-server/.env   # 처음 한 번, OPENAI_API_KEY 입력
powershell -ExecutionPolicy Bypass -File notebook-b/central-server/start.ps1
```

현재 개발 환경은 `uv`로 같은 가상환경과 패키지를 설치했다. lock은 검증한 개발 의존성을 고정한다.
기본 주소 http://127.0.0.1:8000, Swagger http://127.0.0.1:8000/docs. 종료는 Ctrl+C.
서버는 loopback에만 열며 외부 공개/방화벽 변경을 하지 않는다.

첫 실행 시 `runtime/secrets.json`에 admin/reporter/agent 토큰을 생성한다.
재실행해도 기존 토큰을 덮어쓰지 않으며 화면에 토큰을 출력하지 않는다.
DB는 `runtime/central.sqlite3`. runtime과 가상환경은 Git에서 제외한다.
이 파일에는 실제 인증 정보가 있으므로 다른 사용자와 공유하거나 GitHub에 올리지 않는다.
신고자 토큰은 개인별로 별도 `subject`를 부여한다. 기본 demo-reporter는 로컬 접수 검사에만 사용한다.
환경변수 `CCTV_B_TOKENS`에 `{token:{role,subject}}` JSON을 넣으면 파일보다 우선한다.
자격증명이 없거나 잘못되면 인증을 끄지 않고 시작을 거부한다.

## 관리자 모의 신고 검사

서버가 실행 중인 별도 PowerShell에서 다음을 실행한다. 토큰 값은 출력하지 않는다.

```powershell
$credentials = Get-Content -Raw -Encoding UTF8 notebook-b/central-server/runtime/secrets.json | ConvertFrom-Json
$adminToken = ($credentials.tokens.PSObject.Properties | Where-Object { $_.Value.role -eq 'admin' } | Select-Object -First 1).Name
$headers = @{ Authorization = "Bearer $adminToken" }
$payload = @{
    description = '모의 신고 접수 검사'
    latitude = 37.5
    longitude = 127.0
    location_kind = 'demo'
    details = '테스트용 좌표이며 실제 사건이 아님'
} | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:8000/api/v1/demo/reports -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($payload))
```

예시 좌표는 요청 검사용이며 실제 카메라 위치로 등록하지 않는다.
반환되는 대기 작업을 AI 분석 성공으로 해석하지 않는다.

## A 연결

1. 양쪽 Tailscale 로그인과 A의 HTTPS Serve 활성화를 확인한다. 현재 B 설치/로그인과 A 포트·HTTPS 인증은 실제 확인했다.
2. Taildrop 등으로 별도 전달받은 `a-secrets.json`을 B의 `runtime/a-secrets.json`에 둔다.
   파일의 필수 키는 `token,rtsp_user,rtsp_password`이며, B 자체 인증용 `runtime/secrets.json`과 별개다.
   파일이 있으면 A HTTPS 주소를 기본 사용한다. 주소 변경 시 파일의 선택 키 `adapter_url`을 지정한다.
   `CCTV_A_SECRETS_FILE`로 다른 로컬 파일을 지정할 수 있고 `CCTV_ADAPTER_URL/TOKEN` 환경변수가 우선한다.
3. B 서버를 재시작하고 관리자 권한으로 `POST /api/v1/admin/agent/sync`를 호출한다.
4. 동기화된 카메라에만 `PUT /api/v1/admin/cameras/{id}/location`으로 실제/데모 위치와 승인을 등록한다.
5. `GET /api/v1/admin/reports/{id}/candidates`로 거리 후보를 확인한다.

현재 A 세 채널의 실제 위치·시연 구역·분석 승인은 미등록이다. 실제 위치와 촬영 대상 동의가 확인되기 전에는 승인하지 않는다.
`verify_connection.py`는 현재 포트와 HTTPS 상태·인증을 점검하고 비밀 값 없는 기록만 `runtime/connection.json`에 저장한다.
이 도구는 실제 영상을 읽거나 저장하지 않는다.

원격 Adapter는 HTTPS와 인증서 검증을 사용한다. HTTP는 명시적인 loopback 테스트 주소만 허용한다.
리다이렉트는 따르지 않고 시스템 프록시를 사용하지 않는다. A URL에 토큰이나 사용자 정보를 넣지 않는다.
서버는 이 폴더의 `.env`를 자동으로 읽는다(Git 제외). 같은 이름의 환경변수가 있으면 환경변수가 우선한다.
카메라는 요청 시 동기화한다. 후보 조회 전 동기화해야 하며 60초 지난 관측은 분석 후보에서 제외한다.
공개 위치정보만 있는 CCTV를 승인된 영상 소스로 등록하면 안 된다.
현재 시연 영상 입력은 A 웹캠 `cam-01/02/03`만 허용한다. 실제 공공 CCTV는 지도·목록 표시 전용이고 AI 학습·분석·시연 영상·보존 대상에서 제외한다.
다른 카메라에 기존 승인값이 남아 있어도 후보 선정·보존을 차단하며 새 분석 승인도403으로 거부한다. 카메라 목록의 `demo_source`는 세 웹캠 여부를 나타낸다.

## 공개 CCTV 위치

`GET /api/v1/admin/public-cameras`는 [부산광역시 공식 자료](https://www.data.go.kr/data/15082060/fileData.do)의
21,009개 장비 기록을 제공한다. 원문 21,060행에서 좌표 오류 49행과 동일 기록 2행을 제외했다.
자료명 기준일은 2025-12-29, 실제 다운로드일은 2026-10-22다. 최신 설치·운영 상태를 보장하지 않는다.
`west,south,east,north` bbox 필터와 limit/offset 페이지를 지원한다. 기본100, 최대1000행이다.
개별 장비 기록이며 고유 좌표 10,521쌍을 확인된 설치지점 수로 해석하지 않는다.
출처·제외 기록·원문 해시는 [data/README.md](data/README.md)와 source-manifest에 유지한다.
모든 항목은 `metadata_only=true,analysis_available=false`이며 A의 위치나 승인으로 복사하지 않는다.

## 녹화 클립 보존

관리자는 `POST /api/v1/admin/reports/{id}/preserve`에 `camera_id,start,duration`을 전달한다.
등록·승인·위치종류가 일치하는 카메라에서만 지정 구간을 추출한다. 과거 녹화이므로 현재 온라인 여부는 필수 조건이 아니다.
녹화 범위 공백은409, A/B 보존 작업이 사용 중이면429, 크기·해시·파일 형식 불일치는502다.
파일은 2GiB 이하, 요청 길이는 3600초 이하로 제한하며 다운로드 실패 시 임시 파일과 DB 목록을 남기지 않는다.
보존 파일·메타데이터는 SQLite와 `runtime/clips`에 저장하고 생성/다운로드의 관리자 subject를 감사 기록에 남긴다.
목록은 `GET /api/v1/admin/reports/{id}/clips`, 다운로드는 응답의 `download_path`를 사용한다. 관리자만 접근할 수 있다.
다운로드 전에 보관 파일 해시를 다시 검사한다. 보존 파일은 자동 삭제하지 않는다.

이는 **원본 녹화에서 remux된 파생 MP4**다. ffprobe 재생 길이와 첫 프레임 디코딩을 확인하며 전체 영상 디코딩이나 시간 연속성은 보장하지 않는다.
`duration_matches_request`가 false이면 길이 차이가1초를 넘으므로 관리자가 내용을 확인해야 한다.
`CCTV_B_CLIPS_DIR`로 B 저장 폴더를 바꿀 수 있다. FFmpeg 위치는 `CCTV_FFMPEG/CCTV_FFPROBE`로 지정할 수 있다.
이 기능의 자동화 검증은 합성 영상으로 수행했다. 실제 A 영상 보존은 승인이 등록될 때까지 수행하지 않는다.

## 검증

```powershell
notebook-b/central-server/.venv/Scripts/python.exe -m pytest -q
notebook-b/central-server/.venv/Scripts/python.exe notebook-b/central-server/doctor.py
notebook-b/central-server/.venv/Scripts/python.exe notebook-b/central-server/verify_connection.py
```

테스트는 임시 DB/가상 A 응답을 사용하며, HTTP 기동 검사는 실제 Uvicorn 하위 프로세스를 사용한다.
A의 실시간 녹화 서버를 시작하거나 실제 외부 영상을 조회하지 않는다. 영상 테스트에는 B FFmpeg 도구가 필요하다.
하드웨어와 외부망 검증은 [B 검증 기록](../../shared/B-검증기록.md)을 참고한다.
