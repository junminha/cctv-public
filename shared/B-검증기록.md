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
