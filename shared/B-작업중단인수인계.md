# B 작업 중단 인수인계

> **2026-10-22 재개 완료.** 아래는 중단 당시 기록이다. 재개 후 구현·검증 결과는 `STATUS.md`와 `B-검증기록.md` 3차를 따른다.
> Expo 앱은 휴대폰 연결과 함께 별도로 진행하기로 사용자가 결정했다.

2026-10-22, 사용자 요청: 사용량 사유로 현재 작업과 다음 계획을 GitHub에 올리고 중단.
**재개 요청 전에는 작업을 진행하지 않는다.** 진행하던 관리자 UI/영상 엔진/OpenAI 모듈 작업도 중단했다.

## 저장 위치와 완료 기준

- 저장소: https://github.com/junminha/cctv
- B 브랜치: `work/b-server`, 초안 PR: https://github.com/junminha/cctv/pull/1
- 마지막 기능 커밋: `49dd9a1` (시연 영상 입력을 웹캠 3대로 제한).
- 완료한 기능의 최종 전체 테스트: Python3.11 B 가상환경에서 `python -m pytest -q` → **74 passed**, 경고/스킵 없음.
- 이번 중단 정리에서는 문서만 추가했으며 전체 테스트를 다시 실행하지 않았다.
- `main`은 A의 작업이 들어오는 브랜치다. B 브랜치를 기준으로 재개하고 A 코드를 수정하지 않는다.

## 이미 구현한 것

1. FastAPI/SQLite, 관리자·신고자·agent 인증과 신고 소유권, 신고/대기 작업 저장.
2. A 상태/카메라 동기화, 승인된 위치 반경 후보, 녹화구간 조회.
3. 추출 MP4 바이트/SHA256/재생 길이/첫 프레임 확인, 사건별 보존/다운로드, 감사 기록.
4. 부산 공식 공개 CCTV 위치 21,009개 장비 기록의 카탈로그 API, 원문/해시/오류 기록.
5. 공개 CCTV는 지도·목록 전용. AI 학습·분석·시연 영상·보존에서 제외.
6. 영상 입력은 cam-01(내장), cam-02/03(USB)만 허용. 다른 카메라는 기존 승인이 있어도 후보/보존에서 차단.
7. B Tailscale·FFmpeg 설치와 A 실제 TCP443/8555·HTTPS 인증/상태 확인 완료.

실제 A 웹캠 위치/시연 구역·촬영 대상 동의/분석 승인은 아직 미등록이다. 임의로 설정하지 않는다.
실제 A 영상 분석/보존은 하지 않았으며 영상 테스트는 합성 MP4로 수행했다.

## 아직 구현하지 않은 것

- API 키 입력용 실제 `.env` 파일 생성 및 자동 로딩. 기존 `.env.example`은 참고용이고 현 서버는 자동 로드하지 않는다.
- YOLO/MediaPipe 엔진, PyTorch CUDA 추론, GPU 작업 큐와 선택적/집중 분석·전체 분석 비교.
- OpenAI 신고 분류/음성 전사/구조화 요약. API 키는 아직 입력받지 않았으며 실제 API 호출도 하지 않았다.
- 첨부 업로드, WebSocket, 사건 확인/종결, 지표/비교 API, 승인된 웹캠 최근 프레임 조회.
- Next.js 관리자 화면. `notebook-b/admin-web`에는 아직 README만 있다.
- 스마트폰 Expo 앱은 당초 하드웨어 분담에 따라 마지막 별도 단계다.

새 모듈의 실제 소스 파일·추가 패키지·모델은 이번 전체 기능 작업에서 아직 생성/설치하지 않았다.
설계와 문서 확인 후 중단했으며 미완성 구현을 동작하는 기능으로 표시하지 않는다.

## 재개 순서

1. `AGENTS.md`, `cctv 최종.md`, `STATUS.md`, `API.md`, `B-전체기능계획.md`, 이 문서를 읽는다.
2. 브랜치와 작업 상태를 확인하고 `git pull --ff-only`, A 최신 변경을 안전하게 통합한다.
3. B `central-server/.env`와 추적 가능한 `.env.example`을 준비한다. 실제 `.env`는 Git 제외를 유지한다.
4. 설정 로더·API 계약을 먼저 구현하고 백엔드/영상 엔진/관리자 UI를 파일 소유권을 나눠 진행한다.
5. 합성 영상·가상 A/가상 OpenAI 테스트, 실제 CUDA 합성 영상 추론, 관리자 브라우저 검사로 검증한다.
6. 실제 웹캠 검증은 위치·촬영 대상 분석 승인이 등록된 뒤 진행한다.

### 준비할 `.env` 항목

- `OPENAI_API_KEY` (사용자 입력, 기본 빈 값)
- `OPENAI_MODEL=gpt-4.1-mini`, `OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe` (재개 시 지원 여부 재확인)
- `CCTV_WORKER_ENABLED`, `CCTV_AI_DEVICE`, `CCTV_YOLO_MODEL`, `CCTV_POSE_MODEL`
- 기존 `CCTV_A_SECRETS_FILE`, `CCTV_B_SECRETS_FILE`, `CCTV_B_DATABASE`, `CCTV_B_CLIPS_DIR`
- 기존 도구 경로 `CCTV_FFMPEG`, `CCTV_FFPROBE`

환경변수는 `.env`보다 우선한다. OpenAI 키가 없거나 API가 실패하면 로컬 결과/수동 검토로 처리하고 성공을 꾸미지 않는다.

### 다음 구현의 의존성과 인터페이스

- 백엔드 후보 패키지: openai, python-dotenv, python-multipart, websockets, Pillow. 아직 설치하지 않았다.
- AI 후보: torch2.10.0/torchvision0.25.0 cu128, ultralytics, mediapipe, opencv-python. 공식 설치 지침을 재확인 후 설치한다.
- 영상 `vision.VisionEngine(settings).analyze_clip(...)`와 OpenAI `intelligence.Intelligence(settings)`의 정확한 계약은 전체 기능 계획에 기록했다.
- 영상/LLM 모듈은 import 시 모델을 자동 실행하지 않고 라이브러리/키 미설치를 명시적으로 처리한다.
- UI는 Next App Router/TypeScript/Leaflet, B 서버 프록시, HttpOnly 세션, 단회 WS ticket을 계획했다. API 목록도 전체 기능 계획에 있다.

## 로컬 비밀 자료

A가 Taildrop으로 보낸 파일은 B `notebook-b/central-server/runtime/a-secrets.json`에 있다.
B 인증 정보는 같은 runtime의 `secrets.json`이다. 값은 문서·채팅·GitHub에 출력하지 않는다.
로컬 DB·영상·도구 바이너리·비밀 파일은 Git에 포함하지 않는다.
