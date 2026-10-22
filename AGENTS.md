# CCTV 공동 작업 규칙

먼저 `cctv 최종.md`, `shared/STATUS.md`, `shared/API.md`를 읽는다.

- 하드웨어별 상위 폴더를 유지한다. A: `notebook-a/`, B: `notebook-b/`, 앱: `smartphone/`, 공통 문서: `shared/`.
- A는 내장 전면카메라 1대와 SNAP U2 2대의 독립 녹화·송출 장비다. 모든 AI는 B에서 실행한다.
- 현재 시연의 영상 입력은 A 웹캠 cam-01/02/03만 허용한다. 실제 공공 CCTV는 지도·목록 전용이며 AI 학습·분석·영상 보존에서 제외한다. 향후 AI worker에도 이 제한을 유지한다.
- A의 base는 Adapter/B/인터넷 없이 녹화·재생되어야 한다. Adapter에서 base 프로세스를 관리하지 않는다.
- 같은 USB 모델은 DirectShow 고유 장치 경로로 구분한다. 장치가 없으면 오프라인으로 두며 다른 장치로 임의 재할당하지 않는다.
- `cameras.json`, `secrets.json`, 녹화·추출 영상·로그·바이너리는 커밋하지 않는다. 토큰을 채팅/커밋/검증 산출물에 쓰지 않는다.
- A 담당은 `work/a-*`, B 담당은 `work/b-*` 브랜치를 사용한다. 시작 전 `git pull --ff-only`; 다른 Codex의 변경을 덮어쓰지 않는다.
- 공유 API 변경은 `shared/API.md`에 먼저 기록한다. A/B에서 같은 문서나 인터페이스를 동시 변경할 때 충돌을 확인한다.
- 완료 보고에 실제 검증 명령과 결과를 남긴다. B가 없으면 외부망 검증 완료라고 하지 않는다. 모의 영상은 실제 성공으로 보고하지 않는다.
- A 검증: `python notebook-a/cctv-base/tests.py`, 하드웨어 통합 검증 `python notebook-a/cctv-base/verify.py`.
- 다른 컴퓨터에서 문서만 읽으려고 A 시작 스크립트를 실행하지 않는다. B 소프트웨어는 A의 로컬 장치 경로를 사용하지 않고 Adapter 계약만 사용한다.
