# B 1차 서버 검증 기록

날짜: 2026-10-22. **노트북 B에서 수행**. 대상: `work/b-server`.
A 기준 커밋: `5f85b05` (A 녹화·Adapter·Tailscale relay 수정 포함).

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
