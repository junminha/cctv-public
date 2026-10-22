# B 서버 1차 구현 계획

기준: `cctv 최종.md`, A Adapter v1. 사용자 요청에 따라 이 세션에서 바로 구현한다.
작업 브랜치: `work/b-server`. A 코드와 스마트폰 앱은 변경하지 않는다.

## 설계와 범위

Python 3.11 + FastAPI/Pydantic + SQLite로 신고 접수부터 작업 대기 상태까지 구성한다.
실제 AI worker가 없으므로 작업은 `queued / awaiting_worker`로 유지하며 분석 완료를 만들지 않는다.
관리자 모의 신고와 일반 신고는 동일한 저장 함수를 사용한다.
토큰마다 역할과 소유자(subject)를 구분하여 신고자는 본인 상태만 조회한다.
A는 HTTPS Adapter로만 읽고, 로컬 장치 경로나 A 프로세스는 다루지 않는다.
카메라 좌표와 접근 승인은 관리자가 등록하며 real/demo 위치를 섞지 않는다.
좌표 미등록·오프라인·60초 지난 상태는 후보에서 제외한다. 거리 후보는 AI 관련성 순위가 아니다.

## 구현 순서와 검증

- [x] `central-server/tests/`에 인증 누락·역할·소유권·입력 검증·재시작 후 저장 테스트를 먼저 작성하고 실패 확인.
- [x] `config.py`, `models.py`, `store.py`, `app.py`에 설정·스키마·트랜잭션·신고 API 구현 후 테스트 통과.
- [x] A 응답 fixture로 토큰 전달·실패·잘못된 응답·비밀정보 제거 테스트를 먼저 작성하고 실패 확인.
- [x] `adapter.py`와 관리자 카메라 동기화·녹화 조회 구현 후 테스트 통과.
- [x] 좌표·권한·거리·신선도·real/demo 분리 테스트를 먼저 작성하고 반경 후보 조회 구현.
- [x] Windows 시작/설정 안내, GPU 진단, 실제 HTTP 서버 기동 검사, 전체 B 테스트와 diff 검토.
- [x] 공유 상태 갱신 후 B 브랜치 커밋·업로드. main과 A 작업은 덮어쓰지 않았다.

업로드: `work/b-server`, 구현 커밋 `920baf6`. [초안 PR #1](https://github.com/junminha/cctv/pull/1).

실제 A 연결은 A Tailscale URL·토큰과 양쪽 로그인 후 검증한다.
GPU 드라이버 확인은 PyTorch CUDA 추론 성공과 구분한다.
YOLO/MediaPipe·첨부 업로드·증거 보존·WebSocket·Next.js는 다음 구현 범위다.
