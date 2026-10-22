# B 1차 서버 검증 기록

날짜: 2026-10-22. **노트북 B에서 수행**. 대상: `work/b-server`.
A 기준 커밋: `5f85b05` (A 녹화·Adapter·Tailscale relay 수정 포함).
구현 커밋: `920baf6`. [초안 PR #1](https://github.com/junminha/cctv/pull/1), main 병합 전.

## 실제 환경 확인

명령: `nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader`

- NVIDIA GeForce RTX 3060 Laptop GPU, 6144MiB, driver 610.62.
- B 서버 가상환경 Python 3.11.9.
- `doctor.py`: PyTorch 미설치, FFmpeg/Tailscale 실행 파일 미발견.
- GPU 드라이버가 보인다는 것은 PyTorch CUDA 추론이나 YOLO 성능 검증이 아니다.

## 실행한 소프트웨어 검증

저장소 루트에서:

```powershell
notebook-b/central-server/.venv/Scripts/python.exe -m pytest -q
notebook-b/central-server/.venv/Scripts/python.exe notebook-b/central-server/doctor.py
git diff --check
```

- pytest: **38 passed**, 경고 없음.
- 인증 누락/잘못된 토큰 401, 역할 위반 403, 다른 신고자 상태 조회 404.
- 일반/모의 신고 동일 저장 경로, 신고·작업 동시 저장, 서버 인스턴스 재생성 후 동일 작업 조회.
- 내용/좌표/시간대/반경/추가 필드 입력 검증.
- A 인증 헤더 전달, 카메라 ID 유지, 장치 경로·불필요한 비밀 필드 제거.
- A 미설정/인증 오류 시 503, 잘못된 JSON/타입/중복 ID 시 502, 실패 시 기존 카메라를 사용 불가로 표시.
- 카메라 위치·승인 등록 유지, 미등록·미승인·오프라인·다른 위치종류·반경 밖·오래된 상태는 후보 제외.
- 녹화 조회 시간대 UTC 변환, 역전/동일 시간과 잘못된 카메라 거부.
- 실제 Uvicorn 하위 프로세스 기동 → 실제 HTTP 신고 → 상태 조회 → 종료 확인.
- 비밀 설정 생성 재실행 시 기존 파일 유지, 토큰 표준출력 비노출 확인.
- 별도 코드 리뷰에서도 같은 38개 테스트 통과 및 범위 내 수정 필요 결함 없음 확인.

## 수행하지 않은 검증

- A 응답 테스트는 httpx MockTransport의 **가상 A 응답**이다. 실제 A 연결 시험이 아니다.
- 실제 HTTP 기동 시험은 **B 로컬 서버**만 확인한다. 다른 인터넷 연결이나 A 영상 수신이 아니다.
- B Tailscale 로그인, A HTTPS Serve 접근, 인증 RTSP 수신, 녹화 파일 다운로드/재생/해시는 아직 미검증이다.
- A 주소와 RTSP 정보는 최신 공유 API에 기록되었으나 비밀 토큰은 전달받지 않았다.
- 카메라 실제/데모 좌표는 아직 등록하지 않았다. 테스트 좌표는 임시 DB에만 사용한다.
- AI worker/YOLO/MediaPipe/OpenAI, GPU 추론, 첨부, 사건 보존, WebSocket, 관리자 UI, 앱은 아직 미구현이다.

로컬 인증 정보·DB·영상·패키지 바이너리는 Git에 포함하지 않는다.

## 2차 — 실제 A 연결·영상 보존·공개 위치 데이터

2026-10-22 01:41 UTC 기준, B 장비 `notebook-b-example`에서 수행.

- B Tailscale 1.104.2 설치/Running 확인. 전달된 Taildrop 파일은 B `runtime/a-secrets.json`에 저장했고 비밀 값은 출력하지 않았다.
- A의 TCP **443/8555 모두 접속 성공**. HTTPS 인증서 검증을 유지한 상태로 무인증 health401, 인증 health/cameras/capabilities200 확인.
- `tailscale ping --c 2 --timeout 5s 192.0.2.10`: direct 응답 약26ms. 이는 영상 지연이나 다른 인터넷 시험 결과가 아니다.
- B FastAPI의 실제 A 동기화와 health 경로도200 확인. 로컬 DB에 cam-01/02/03 세 채널을 동기화했고 모두 위치 null·분석 승인 false를 확인했다.
- 실제 A 영상의 RTSP 디코딩·프레임 저장·클립 추출/보존·AI 분석은 하지 않았다. 포트 접속 성공과 실제 영상 수신은 다르다.
- B 전용 FFmpeg9.0.2/ffprobe를 SHA256 확인 후 설치. A 실행 스크립트는 실행하지 않았다.

추가 명령:

```powershell
notebook-b/central-server/.venv/Scripts/python.exe notebook-b/central-server/setup_tools.py
notebook-b/central-server/.venv/Scripts/python.exe notebook-b/central-server/verify_connection.py
```

영상 보존은 **합성 검은 화면 2초 MP4 + 가상 A 응답**으로 검증했다.
바이트·SHA256 확인, MP4 형식 고정, 외부 track 참조 차단, 첫 프레임 실제 디코딩, 재생 길이 확인,
SQLite 재시작 후 조회, 관리자 다운로드/HTTP Range, 생성·다운로드 감사 기록을 검사했다.
미승인·위치종류 불일치·타 역할·녹화 공백·A busy·잘못된 해시/크기/경로/영상·파일 변조를 거부한다.
리뷰에서 재현된 ffconcat 참조 파일 오인식과 극단적인 날짜/녹화길이 overflow는 회귀 테스트 후 수정했다.

공개 CCTV 위치는 [부산광역시 공식 자료](https://www.data.go.kr/data/15082060/fileData.do)를 사용한다.
원문21,060행 중 좌표 오류49행·동일 기록2행을 제외해 **21,009개 장비 기록**, 16구군, 고유 좌표10,521쌍을 제공한다.
고유 좌표 수를 설치지점 수로 확정하지 않는다. 자료명 기준일2025-12-29, 포털 수정일2026-01-07,
실제 다운로드2026-10-22로 구분했으며 출처/해시/오류 행은 `central-server/data`에 유지한다.
공개 위치는 모두 `metadata_only=true,analysis_available=false`이며 A 승인이나 영상 후보로 사용하지 않는다.

2차 최종 전체 B 테스트: **72 passed**, 경고/스킵 없음. 독립 리뷰에서도72개 통과 확인.
원문 CP949 CSV는 Git의 줄바꿈 변환을 비활성화해 SHA256을 유지하며, 정규화 JSON은 플랫폼 공통 LF로 저장한다.

## 현재 시연 소스 제한

사용자 결정에 따라 실제 공공 CCTV는 지도·목록 전용으로 유지하고 AI 학습·분석·영상 보존에서 제외했다.
영상 입력은 웹캠 cam-01/02/03만 허용한다. 추가 카메라 cam-04의 분석 승인 요청403과,
기존 DB에 승인이 있어도 후보·보존에서 제외되는 동작을 회귀 테스트했다.
전체 B 테스트: **74 passed**, 경고/스킵 없음. 웹캠 실제 위치·촬영 대상 동의 정보는 임의 변경하지 않았다.

## 3차 — AI worker·OpenAI 모듈·관리자 화면 (2026-10-22 재개)

B 장비 `notebook-b-example`, 브랜치 `work/b-server`. A 코드는 변경하지 않았다.

### 환경

- `nvidia-smi`: RTX 3060 Laptop, 6144MiB, driver 610.62. PyTorch `2.14.1+cu130`, `torch.cuda.is_available()=True`.
- 계획의 cu128/torch 2.10 대신 드라이버가 지원하는 공식 cu130 최신 휠을 사용했다. `requirements-ai.txt`, `requirements-dev.lock`에 고정.
- 모델: `setup_models.py`로 YOLO26n(Ultralytics 공식 릴리스)과 MediaPipe Pose Landmarker lite를 `runtime/models`에 받고 SHA256을 manifest에 기록. Git 제외.
- OpenAI 공식 문서(2026-10-22 확인): `gpt-4.1-mini`(2027-01-14 종료), `gpt-4o-mini-transcribe`(2027-02-26 종료)가 지원 종료 예정이라
  기본값을 권장 대체 모델 `gpt-6-luna`, `gpt-transcribe`로 정했다. 키를 받지 않았으므로 **실제 OpenAI API 호출은 하지 않았다**.

### 자동 테스트

```powershell
notebook-b/central-server/.venv/Scripts/python.exe -m pytest -q notebook-b/central-server/tests
```

- **97 passed** (기존 74 + 신규). 신규 범위:
  - `.env` 로드와 환경변수 우선, 잘못된 AI 설정 거부.
  - **실제 CUDA 추론**: Ultralytics 샘플 사진으로 만든 합성 영상(서 있는 사람+버스 / 90° 회전한 사람 / 빈 화면).
    쓰러짐 신고에서 관련성 1.0 / 0.25 / 0 순으로 구분. 차량 신고에서 정지 차량 후보 감지. 모델 없음·손상 영상은 명시적 실패.
  - OpenAI 모듈: 가짜 클라이언트로 스키마 출력, `verified=false`·`requires_human_review=true` 강제, API 실패 시 로컬 전환과 오류 내용 비노출.
  - 가상 A + 실제 모델 전체 흐름: 3대 후보 중 누운 사람이 있는 cam-02만 집중 분석, 차량 신고는 cam-01 선정(신고에 따라 선정 카메라가 달라짐),
    비교 실험에서 선정 일치·처리 프레임 감소, 반경 밖·카메라 오프라인·A 미설정·비전 실패 결과 구분, live 소스의 인증 RTSP 요청,
    첨부 동의·형식·소유권, 확인/종결, WebSocket 단회 ticket·Origin, 최근 프레임 승인 조건, 요청 시각 기준 지연.

### 브라우저 검증 (Playwright, 1440×900·390×844)

임시 DB·임시 토큰의 별도 B 인스턴스와 loopback **가상 A**(합성 12초 영상 3개)를 사용했다. 실제 B DB·실제 카메라 승인은 바꾸지 않았다.

- 미로그인 시 `/login`으로 이동, admin 토큰 로그인 후 HttpOnly 쿠키, 쿠키 없는 프록시 요청 401, `api/v1` 밖 경로 404.
- 카메라 등록 화면에서 세 가상 카메라 위치·구역 입력, 동의 확인 후 승인 저장.
- 지도에서 지점 선택 → 모의 신고 접수 → 실시간 목록 갱신 → cam-02 집중 분석·근거 프레임·로컬 요약 표시.
- 비교 실험: 같은 클립에서 선택 67프레임/2.89s, 전체 102프레임/4.84s, 34% 감소, 선정 일치(합성 영상 결과이며 현장 성능 아님).
- 보존 버튼으로 cam-02 구간 보존 → 프록시 다운로드 SHA256 일치. 확인 완료 기록.
- 화면 점검에서 canvas 지도 마커 색 미적용, 패널 스크롤, 점수 표시 겹침, 재분석 지연 기준 오류를 발견해 수정 후 재확인했다.
- `npx tsc --noEmit` 통과, `npx eslint .` 오류 0(의도한 전체 페이지 이동 경고 2), `npx next build` 성공.

### 실제 A 확인과 미수행

- `verify_connection.py`(03:05 UTC): TCP 443/8555 연결, 무인증 401, 인증 health/cameras 통과, cam-01~03 online·recording.
- 실제 A 웹캠 영상의 RTSP 디코딩·분석·보존, 실제 OpenAI 호출, 다른 인터넷 실측, 전시장 조명·가림 조건 성능은 **수행하지 않았다**.
  웹캠 위치·출연자 동의가 등록되면 진행한다.
