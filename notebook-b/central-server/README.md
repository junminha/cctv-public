# B 중앙 서버

Python 3.11 + FastAPI + SQLite. **이 폴더는 노트북 B에서만 실행한다.**
A 녹화 프로그램이나 USB 장치에 직접 접근하지 않고 [공유 API](../../shared/API.md)의 Adapter만 읽는다.

## 구현 상태

- 관리자/신고자/agent Bearer 인증과 신고 소유자별 상태 조회.
- 일반·관리자 모의 신고를 동일한 트랜잭션으로 저장. 서버 재시작 후 신고와 작업 유지.
- A 카메라 동기화, 녹화구간 조회. A 장애 중에도 신고 접수 가능.
- 관리자 위치/승인 등록, 실제/데모 위치 구분, 60초 이내 관측·온라인·승인·반경 조건 후보 조회.
- 작업 상태는 `queued / awaiting_worker`. **AI 분석 worker는 아직 없으며 자동 분석하지 않는다.**
- 영상 수신/추출·보존, 첨부파일, WebSocket, YOLO/MediaPipe/OpenAI, Next.js, Expo는 후속 단계다.

## 설치·실행 (저장소 루트 PowerShell)

```powershell
py -3.11 -m venv notebook-b/central-server/.venv
notebook-b/central-server/.venv/Scripts/python.exe -m pip install -r notebook-b/central-server/requirements-dev.lock
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

1. 양쪽 Tailscale 로그인과 A의 HTTPS Serve 활성화를 확인한다.
2. 시작할 PowerShell에 `CCTV_ADAPTER_URL`과 `CCTV_ADAPTER_TOKEN`을 설정한다.
   현재 A 예정 주소는 `shared/STATUS.md`를 확인한다. 비밀 토큰은 A 담당자로부터 별도로 전달받는다.
3. B 서버를 재시작하고 관리자 권한으로 `POST /api/v1/admin/agent/sync`를 호출한다.
4. 동기화된 카메라에만 `PUT /api/v1/admin/cameras/{id}/location`으로 실제/데모 위치와 승인을 등록한다.
5. `GET /api/v1/admin/reports/{id}/candidates`로 거리 후보를 확인한다.

원격 Adapter는 HTTPS와 인증서 검증을 사용한다. HTTP는 명시적인 loopback 테스트 주소만 허용한다.
리다이렉트는 따르지 않고 시스템 프록시를 사용하지 않는다. A URL에 토큰이나 사용자 정보를 넣지 않는다.
`.env.example`은 참고용이며 `start.ps1`은 `.env` 파일을 자동 로드하지 않는다.
카메라는 요청 시 동기화한다. 후보 조회 전 동기화해야 하며 60초 지난 관측은 분석 후보에서 제외한다.
공개 위치정보만 있는 CCTV를 승인된 영상 소스로 등록하면 안 된다.

## 검증

```powershell
notebook-b/central-server/.venv/Scripts/python.exe -m pytest -q
notebook-b/central-server/.venv/Scripts/python.exe notebook-b/central-server/doctor.py
```

테스트는 임시 DB/가상 A 응답을 사용하며, HTTP 기동 검사는 실제 Uvicorn 하위 프로세스를 사용한다.
A의 실시간 녹화 서버를 시작하거나 실제 외부 영상을 조회하지 않는다.
하드웨어와 외부망 검증은 [B 검증 기록](../../shared/B-검증기록.md)을 참고한다.
