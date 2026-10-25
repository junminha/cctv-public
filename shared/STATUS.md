# 협업 인수인계

기준일: 2026-10-23. A/B 공동 인수인계 문서다. B 작업은 **노트북 B**, `work/b-server` 브랜치에서 진행한다.

## 진행 범위

- A: 내장 HD Webcam 1대 + SNAP U2 2대. DirectShow 고유 경로에 cam-01/02/03을 고정 등록.
- A base: FFmpeg → MediaMTX RTSP/TCP, 로컬 3채널 HLS 화면, 연속 fMP4 녹화, 시간 검색·MP4 재생, 공간 하한·채널 재시도·프로세스 관리 구현.
- A 화면은 frontend-design 스킬을 적용해 밝은 관제 화면으로 재구성했다. 선택 카메라 집중 보기/전체 보기/전체 화면, 카메라별 녹화 증거·재접속 표시, 검색 결과 옆 과거 재생, 시스템 정보 창과 모바일 배치를 제공한다. 외부 폰트·아이콘·프런트엔드 패키지 의존성은 없다.
- 별도 Adapter: Bearer 인증, 상태/카메라/녹화구간/추출·SHA256/감사 로그 구현. 별도 Tailscale 전용 RTSP relay 설정 코드 제공.
- 실제 수행한 검증 결과는 `A-검증.json`과 `A-검증기록.md`를 참고한다. 결과 파일이 없거나 항목이 NOT_TESTED라면 완료된 것으로 해석하지 않는다.
- Tailscale 1.104.2 설치 및 A 로그인 확인. A 주소 `192.0.2.10`, 이름 `notebook-a.example.invalid`.
- 인증 RTSP relay가 A Tailscale 주소의 8555 포트에서 실행 중. A 자체 3채널 디코딩·무인증 차단 시험 완료. B `notebook-b-example`이 같은 tailnet에서 연결됐고 B→A TCP443/8555 및 direct ping 성공. B 실제 영상 디코딩/다른 인터넷 수신은 아직 미검증이다.
- HTTPS API 활성화 완료: `https://notebook-a.example.invalid`. A 자체 HTTPS 시험에서 인증서 검증·무인증 401·인증된 health/cameras/capabilities/stream/recordings 200 확인. Serve는 tailnet 내부 전용이다.
- B: FastAPI·SQLite·역할별 인증·신고/대기 작업 저장·A 상태 동기화·승인된 위치 반경 후보·녹화 추출본 검증/보존/다운로드·감사 기록을 구현했다. 실제 HTTPS 인증/상태 조회와 74개 소프트웨어 테스트 완료. [B 검증 기록](B-검증기록.md) 참고.
- B 공개 위치 API: 부산 공식 자료의 21,009개 장비 기록(16구군)을 정제해 별도 위치 카탈로그로 제공한다. 공개 위치는 영상 분석권한이 아니며 A 카메라에 복사하지 않는다.
- 사용자 확정 범위: 실제 공공 CCTV는 지도·목록 표시만 하고 AI 학습·분석에서 제외한다. 영상 시연·후보 선정·보존은 A 웹캠 cam-01/02/03만 허용하며 코드에서도 다른 입력을 차단한다.
- B 2차(2026-10-22 재개): `.env` 자동 로드, PyTorch 2.14.1+cu130 CUDA, YOLO26n + MediaPipe Pose 영상 엔진, OpenAI 분류·전사·요약(키 없으면 로컬 처리),
  신고→반경 후보→저FPS 탐색→집중 분석 worker(선택/전체/비교), 첨부 업로드, 확인·종결, 근거 프레임, 최근 프레임, 지표, WebSocket, Next.js 관리자 화면을 구현했다.
  B 테스트 97개 통과. 실제 GPU 추론과 브라우저 흐름은 **합성 영상 + 가상 A**로 검증했다. [B 검증 기록](B-검증기록.md) 3차 참고.
- 실제 A 웹캠 영상의 분석·보존은 아직 하지 않았다. cam-01~03의 실제 설치 위치·시연 구역·출연자 동의가 등록되지 않았기 때문이다.
- B 3차(2026-10-23, `work/b-app`): 시민 신고 앱(`smartphone/reporter-app`, Expo SDK 58)과 서버 확장 v0.3(`shared/API.md`).
  아이디·비밀번호 회원가입/로그인(이메일·전화번호 없음), 내 신고 목록·상세, 위치만으로 신고, GPS 원위치 저장,
  음성 전사 후 분류, 사진 YOLO·MediaPipe 분석, 늦게 온 첨부 반영 재분석. 디자인은 Figma(사용자 확인)대로 구현.
  B 테스트 102개 통과. 앱은 타입검사·lint·expo-doctor 통과, 브라우저 미리보기로 가입→설정→신고→사진 업로드→목록·상세 흐름을
  별도 시험 서버(임시 DB)에서 확인했다. **실제 휴대폰(Expo Go)·카메라·녹음·외부망 신고는 아직 검증하지 않았다.**

## 다음 B 작업

### 2026-10-26 긴급 알림·추천 CCTV 지도 번호·대응 기록·신고자 처리 상태·유형별 통계 (`work/b-app`)

- API v0.6(`shared/API.md`): 스냅샷 `priority/priority_basis/alert_acknowledged/response_logs`, `POST /api/v1/admin/reports/{id}/log`,
  신고자 `handling`, 지표 `by_incident`·`frame_reduction`.
- 쓰러짐 의심 신고는 분석 전 신고문 키워드만으로 긴급 처리: 상황판·`/live` 상단 배너, 목록 맨 위 고정, 알림음(페이지를 한 번 클릭한 뒤부터).
  `확인`을 누르면 `긴급 알림 확인` 기록이 남는다. 출동 여부는 정하지 않는다.
- 선택한 신고의 추천 공공 CCTV 1~5위를 지도에 번호 핀으로 표시하고, 핀을 누르면 위치·용도·장소 단서·추천 이유를 보여준다. 추천 표와 번호가 같다.
- 대응 방안 각 단계에 `실행 기록`, 자유 메모 기록, 대응 기록 목록. 이벤트·감사 기록으로 남아 증거 ZIP에 포함되고 `/live`에 `LOG` 줄로 보인다.
- 시민 앱 내 신고: 접수 → 주변 CCTV 확인 중 → 담당자 검토 중 → 담당자 대응 중 → 담당자 확인 완료 → 처리 종결 단계와 시각. 담당자 이름·메모는 주지 않는다.
- 성능 비교 화면: 사건 유형별 분석 수·관련 장면 후보 비율·평균 처리 시간·신고부터 시간·평균 프레임, 비교 실험 프레임 감소 범위.
- 실제 검증:
  - `notebook-b/central-server`: `python -m pytest -q` → **118 passed**.
  - `notebook-b/admin-web`: `npx tsc --noEmit`, `npx next build` 통과, `npx eslint components lib` 오류 0(기존 경고 2).
  - `smartphone/reporter-app`: `npx tsc --noEmit`, `npx eslint src` 통과. **실제 휴대폰에서는 아직 확인하지 않았다.**
  - 저장소 루트에서 `playwright-cli -s=response --raw run-code --filename=notebook-b/admin-web/tests/response-ui.js` → 24/24 통과
    (1920·1366 배너·목록 순서·지도 번호 핀·팝업·단계/메모 기록·확인 후 배너 해제·`/live` LOG·통계 표·화면 넘침·페이지 오류). **합성 응답을 쓴 화면 검사다.**
- B 8000·관리자 3000을 새 코드로 재시작했다(세션과 분리된 프로세스). 실제 웹캠 AI 분석·OpenAI 호출은 이번에 실행하지 않았다.

### 2026-10-23 반경 CCTV·대응 방안 화면 연결 (`work/b-app`)

- 관리자 신고 상세와 `/live` 분석 기록에 동일한 CCTV 안내 컴포넌트를 연결했다. 현재 검색 반경의 승인 웹캠 후보 대수·위치,
  공공 CCTV 장비 대수·설치 좌표 수, 상위 5곳의 위치·용도·거리·적합도·추천 이유를 표시한다.
- 공공 CCTV 추천은 위치정보 기준이며 영상 미분석이라고 명시한다. 원자료 용도와 이름으로 추정한 장소 단서를 구분한다.
- 분석 당시 최적 웹캠/공공 CCTV, 대응 우선순위·단계별 조치·근거·담당 기관·주의사항을 표시한다.
  반경 변경 시 현재 안내를 다시 조회하고, 분석 당시 반경이 다르면 재분석 안내를 표시한다.
- 과거 결과에 새 필드가 없으면 재분석 안내를 표시한다. 재분석 중이거나 재분석 실패로 이전 결과가 남아 있는 경우에는
  이전 추천을 이번 결과로 표시하지 않는다. 실패한 분석이라도 이번 요청의 유효한 대응 방안은 표시한다.
- 실제 검증:
  - `notebook-b/central-server`: 기존 venv로 `python -m pytest -q` → **115 passed** (최종 67.45초).
  - `notebook-b/admin-web`: `npm run build`, `npx tsc --noEmit` → 통과. `npm run lint` → 오류 0, 기존 로그인 이동 경고 2개.
  - 저장소 루트에서 `npx --yes --package @playwright/cli playwright-cli -s=guidance --raw run-code --filename=notebook-b/admin-web/tests/guidance-ui.js`:
    1920×1080·1366×768에서 상세와 `/live`의 개수·좌표·용도·추천·대응 표시 및 화면 넘침 검사 통과.
    반경 저장/갱신, 빈 결과, 이전 형식 분석, API 오류/재시도, 지연 응답 중 신고 전환, 자동 선택,
    실행 중/실패한 재분석의 이전 결과 차단 및 이번 실패 결과 표시 검사 통과. **합성 응답을 쓴 화면 검사다.**
  - 별도 실제 데이터 브라우저 검사: 두 화면 모두 API와 같은 **850m / 공공 CCTV 191대 / 95곳** 표시, pageerror 0.
    기존 신고를 변경하거나 재분석하지 않았다. 새 대응 방안 필드가 없는 기존 결과에는 재분석 안내가 나온다.
  - 재시작 후 실제 `/health`, 관리자 nearby, 로그인 및 동일 출처 `/api/b` 프록시와 두 페이지 모두 200.
    nearby 무인증 401, 신고자 403 확인. B worker 실행 및 모델 파일 존재 확인. 현재 OpenAI 키는 미설정이다.
- B 8000은 `cctv-app` 코드와 기존 `cctv`의 `.env`·인증·DB·미디어 경로를 유지해 재시작했다.
  관리자 3000은 새 production build를 제공한다. A 장치·승인·영상 및 다른 작업자의 checkout은 변경하지 않았다.
  이번 작업에서 실제 웹캠 AI 분석·OpenAI 호출은 실행하지 않았다.

1. 실행: `notebook-b/central-server/start.ps1`(8000) 후 `notebook-b/admin-web/start.ps1`(3000). admin 토큰으로 로그인한다.
2. 사용자 확인 필요: A cam-01~03의 전시장 설치 위치(좌표 또는 부스 지점)·시연 구역·출연자 동의. 확인되면 관리자 `카메라 등록` 화면에서 입력·승인한다. 임의 좌표나 승인을 넣지 않는다.
3. 승인 후 실제 검증: 최근 프레임(RTSP 디코딩), live/recording 분석, 사건 영상 보존, 비교 실험을 실제 웹캠과 동의한 출연자로 수행하고 기록한다.
4. OpenAI 사용 시 `notebook-b/central-server/.env`의 `OPENAI_API_KEY`에 키를 넣고 서버를 재시작한다. 키는 커밋·채팅에 쓰지 않는다.
5. 다른 인터넷(서로 다른 Wi-Fi/테더링)에서 A↔B 실측.
6. 휴대폰 신고: B API를 휴대폰이 닿는 HTTPS 주소로 노출하는 방법(Tailscale 앱 설치 후 tailnet 내부 Serve, 또는 공개 Funnel)을
   사용자와 정한 뒤 `smartphone/reporter-app/.env`의 `EXPO_PUBLIC_API_URL`에 넣고 Expo Go로 실측한다.

## 미검증/운영 제한

USB 실제 탈착·포트 이동·컴퓨터 실제 재부팅·장시간 부하·실제 디스크 장애·외부망 지연·B AI 성능은 후속 실측 대상이다. 소프트웨어 프로세스 장애 복구와 실제 하드웨어 탈착 시험은 다르다.
저장 기간은 기본 7일, 공간 하한 10GiB이다. 장시간 운영 시 로그와 추출 보존본은 운영자가 관리한다. 보존 기간 만료 원본은 MediaMTX가 정리한다.
A 웹캠 카메라 좌표·분석 승인은 미등록이다. 실제 위치를 임의로 만들어 넣지 않는다. 공개 카탈로그의 2025-12-29 자료명 기준일과 2026-10-22 다운로드일은 구분한다.

## Git 협업

저장소: https://github.com/junminha/cctv (비공개).
`main`을 최신으로 받은 뒤 A/B별 브랜치에서 작업하고, API 변경은 `shared/API.md`와 함께 커밋한다.
작업 종료 시 이 문서의 현재 상태와 실제 확인한 결과를 갱신한다. 실행 파일·로컬 영상·인증 정보는 git에 올리지 않는다.
