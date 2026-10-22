# B 전체 기능 구현 계획

사용자가 B 전체 기능 구현과 API 키 입력용 `.env` 준비를 요청했으나, 사용량 사유로 구현 시작 전에 작업 중단을 요청했다.
2026-10-22 재개해 구현 단위 1~6을 완료했다(검증 범위와 한계는 `B-검증기록.md` 3차). 실제 웹캠 영상 검증은 승인 등록 후 남아 있다.
변경점: PyTorch는 cu130(2.14.1), OpenAI 기본 모델은 `gpt-6-luna`/`gpt-transcribe`, 근거 이미지 경로는 `artifacts/{kind}/{owner}/{file}`.
하드웨어 분담은 유지한다. A는 수정하지 않으며 스마트폰 앱은 마지막 별도 단계다.

## 고정 범위

- 실제 공공 CCTV: 지도/목록만. AI 학습/추론/영상 입력에서 제외.
- 영상 분석 소스: A 웹캠 cam-01/02/03만, 등록 위치와 촬영 대상 동의를 확인한 승인값이 필요.
- B: FastAPI/SQLite, YOLO/Pose, 선택적·전체 분석 비교, OpenAI 선택 연동, 첨부자료, 작업 큐/실시간 상태, 관리자 Next.js.
- OpenAI 키는 B 중앙 서버 `.env`의 OPENAI_API_KEY에 사용자가 입력. 키가 없거나 API가 실패하면 로컬 관찰과 수동 검토로 진행한다.
- 분석 결과는 관찰/의심/미확인을 구분하며 사람의 신원·의학적 상태·위법 사실·출동을 확정하지 않는다.
- 자동 분석 캐시와 수동 보존 자료를 분리한다. 원본 위에 그리지 않고 별도 근거 프레임/오버레이 생성.

## 구현 단위

1. 환경·API 계약: `.env` 자동 로드, 비밀 비노출, 설치/실행 스크립트.
2. 영상 엔진: 실제 GPU YOLO + 선택적 MediaPipe Pose, 제한 FPS 샘플/근거 프레임/관련성 점수. 모델 미설치는 명시적 실패.
3. OpenAI 모듈: 신고 분류, 동의한 첨부 오디오 전사, 선별 이미지/메타데이터 구조화 요약; 서버만 호출.
4. B 백엔드: 첨부 업로드/형식·크기 검증, 영속 작업 상태, 단일 GPU 작업 큐, 선택·집중 분석, 전체 비교, 사람 확인/종결, 통계·감사.
5. Next.js: 로그인, 공식/웹캠 지도 레이어, 카메라 설정/승인, 모의 신고·첨부, 분석 진행/근거/보고서/보존/다운로드, 성능 비교.
6. 실제 모델의 합성 영상 검사 + 가상 A/가상 API 통합 검사 + 브라우저 검증. 실제 A 영상은 승인 미등록이면 읽지 않는다.

## 영상 엔진 모듈 인터페이스

`vision.VisionEngine(settings)`를 생성한다.
`engine.analyze_clip(path: Path, output_dir: Path, *, sample_fps=1.0, max_seconds=15.0, incident_type='OTHER') -> dict`.
반환: `observations`(관찰 배열), `evidence`(file/timestamp_seconds/findings 배열), `relevance_score`(0~1),
`processed_frames`, `elapsed_seconds`, `device`, `warnings`. 파일 경로는 output_dir 내부 파일명만 반환한다.
`vision.VisionUnavailable`는 모델/라이브러리 미설치 등 실제 실행 불가를 나타낸다. import 시 GPU 모델을 로드하지 않는다.

## OpenAI 모듈 인터페이스

`intelligence.Intelligence(settings, client=None)`.
`classify(description: str, details: str='') -> dict` (`incident_type`, `keywords`, `source`, `warnings`).
`transcribe(path: Path) -> dict` (`text`, `source`, `warnings`).
`summarize(report: dict, observations: list, image_paths: list[Path] | None=None, transcripts: list[str] | None=None) -> dict`:
`incident_type,reporter_claim,cctv_observations,phone_observations,unverified_facts,recommended_next_step,requires_human_review,source,warnings`.
키 누락/API 실패는 로컬 처리의 한계를 명시한 구조화 결과로 반환한다. URL이나 명령을 자동 실행하지 않는다.

## 추가 API (기존 `/api/v1` 아래)

- POST `/reports/{id}/attachments`: multipart file + consent=true; 소유자/관리자. 반환 attachment 메타데이터.
- GET `/reports/{id}/attachments/{attachment_id}`: 소유자/관리자 파일 수신.
- POST `/admin/reports/{id}/analyze`: `{mode:'selective'|'all'|'benchmark',source:'recording'|'live',duration:10,sample_fps:1,focus_fps:3,top_k:1}`. 202 작업 접수.
- GET `/admin/reports/{id}`: 기존 필드 + attachments[], analysis, review, events[]. job은 state/stage/progress/error를 포함.
- POST `/admin/reports/{id}/confirm`: `{note:string}`. 사람의 확인 기록.
- POST `/admin/reports/{id}/close`: `{note:string}`. 사건 종결 기록.
- GET `/admin/reports/{id}/artifacts/{filename}`: 관리자 근거 이미지(허용된 파일명만).
- GET `/admin/cameras/{id}/snapshot`: 관리자, 세 웹캠·승인 조건에서만 실제 최근 JPEG. UI는 승인 없으면 호출하지 않는다.
- POST `/admin/ws-ticket`: 관리자용 단회 WebSocket ticket.
- WS `/ws/v1/admin`: 첫 JSON `{ticket:string}` 후 `{type:'snapshot',reports:[...],cameras:[...],time:...}` 주기적 전달. 토큰을 URL에 넣지 않는다.
- GET `/admin/metrics`: 접수/작업/자료/분석 통계와 최근 성능 비교 결과.

기존 camera 위치 입력에 선택 `zone` 문자열을 추가한다. 공개 위치와 웹캠 위치/승인은 분리한다.
영상 분석이 불가능하면 manual_review/failed 상태와 구체적인 이유를 기록하며 성공을 꾸미지 않는다.

## 프런트엔드 연결

Next.js는 FastAPI 127.0.0.1:8000에 서버 프록시한다. 로컬 관리자 토큰을 로그인에 사용하고 HttpOnly 세션 쿠키에 저장한다.
브라우저는 OpenAI/A/RTSP 비밀 설정을 받지 않는다. WS는 단회 ticket으로 FastAPI에 연결한다.
UI는 실제 한국어 관제 작업 흐름으로 구성하고 미등록/실패/진행 상태를 표시한다.
첨부/카메라 승인과 데이터 기준일을 표시한다. 브라우저 RTSP 직접 재생 대신 인증된 최근 프레임과 보존 MP4를 사용한다.
