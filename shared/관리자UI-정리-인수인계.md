# 관리자 화면 정보 정리 — Codex 인수인계 (2026-10-26)

Claude Code 세션에서 Codex로 넘기는 작업이다. 이 문서와 `AGENTS.md`, `shared/STATUS.md` 맨 위 두 항목, `shared/API.md` v0.5·v0.6을 먼저 읽는다.

## 1. 사용자 요청과 진행 순서

사용자 말: "관리자 화면에 정보가 너무 많아서 보기가 힘듦" → 방안 승인 → "codex한테 figma mcp 연결시켜서 관리자 화면 수정본 디자인 figma에서 먼저 만들어보는 과정 하도록".

1. **Figma 디자인 먼저** (지금 단계). 코드 변경 없음.
2. 사용자가 Figma 시안을 확인하고 승인하면 **구현**. 승인 전에는 코드를 고치지 않는다.
3. 구현 후 검증(아래 5절), `shared/STATUS.md` 기록, `work/b-app` 커밋·푸시.

## 2. 현재 상태

- 작업 폴더: `C:\Users\user\Desktop\ahfzk\cctv-app` (git worktree, 브랜치 `work/b-app`, origin에 푸시됨).
  `C:\Users\user\Desktop\ahfzk\cctv`(메인 checkout, `work/b-server`)는 **다른 작업자가 쓰는 곳이라 건드리지 않는다.**
- 최근 커밋: `22d4d97` 긴급 알림·추천 CCTV 지도 번호·대응 기록·신고자 처리 상태·유형별 통계, `2126e44` 서버 v0.6,
  `c4a999b` 반경 CCTV·대응 방안 화면(Codex), `6fa5f82` 서버 v0.5 반경 CCTV 안내·대응 방안.
- 실행 중인 서버(세션과 분리된 프로세스):
  - B FastAPI `127.0.0.1:8000`: `cctv-app` 코드 + 메인 checkout의 `.env`·인증·DB·미디어 경로(환경변수 `CCTV_B_*`로 지정).
  - 관리자 Next.js `127.0.0.1:3000`: `cctv-app/notebook-b/admin-web`의 `next start`.
  - Expo 개발 서버(ngrok), Tailscale Funnel(`/api/v1/auth`, `/api/v1/reports`만 공개)도 켜져 있다. 끄지 않는다.
- OpenAI 키는 아직 B `.env`에 없다(로컬 규칙으로 동작). A 웹캠 cam-01/02/03은 2026-10-23 기준 모두 온라인.

## 3. Figma

- Codex에 Figma 원격 MCP(`figma`, https://mcp.figma.com/mcp)를 연결하고 OAuth 로그인했다.
- 대상 파일: fileKey `NCoiCSwtK24eopChRoFtBz`(시민 앱 디자인이 있는 프로젝트 파일). 페이지 Screens, Components, Reporter tokens는 **수정 금지**.
  새 페이지 **"Admin console v2"** 안에서만 작업한다.
- 만들 프레임(1366×768): ① 대응 탭(긴급 쓰러짐 신고, 분석 완료, 1단계 실행됨·2단계 차례) ② CCTV 탭 ③ 신고 내용 탭 ④ 도구 탭
  ⑤ 분석 중 상태의 대응 탭. 가능하면 현재 화면 캡처를 "현재(before)" 프레임으로 둔다
  (캡처: `output/playwright/response-1366-console.png`, git에 없는 산출물 폴더).
- 끝나면 각 프레임 링크(node-id 포함)를 남기고 **사용자 확인을 기다린다.**

## 4. 디자인·구현 내용 (사용자가 승인한 방안 1단계)

현재 오른쪽 상세 패널(`components/report-panel.tsx` + `components/report-guidance.tsx`)에는 섹션이 약 17개 세로로 이어진다.

1. **상황 카드**(패널 맨 위): 사건 유형, 우선순위(`analysis.response_plan.priority`, 없으면 스냅샷 `priority`), 분석 결과,
   가장 적합한 CCTV(`analysis.best_camera`), 다음에 할 일 1가지 = 이번 분석(`analysis.finished_at`) 이후 `step` 실행 기록이 없는 첫 대응 단계.
   분석 전·중이면 그 상태와 "긴급 상황은 112·119 절차 우선".
2. **탭 4개**(기본 대응, 신고를 바꾸면 대응으로):
   - 대응: 상황 카드, 대응 단계 체크리스트, 대응 기록(메모), 확인·종결
   - CCTV: 후보 웹캠 순위+근거 썸네일(카메라별 한 줄), 반경 안 웹캠·공공 CCTV 개수, 추천 공공 CCTV 번호·이름·거리·적합도 한 줄씩
     (자세한 정보는 지도 번호 핀 팝업 — `components/chart-map.tsx`)
   - 신고 내용: 신고문, 상세 위치, 발생 시각, 첨부, 음성 전사, AI 상황 요약
   - 도구: 반경 조절, 분석 다시 실행(방식·영상·길이·FPS), 비교 실험, 영상 보존, 증거 묶음 ZIP, 처리 기록 전체
3. **대응 체크리스트**: 아직 안 한 첫 단계만 펼침(이유 + "실행 기록"), 끝난 단계 "✓ 시각 · 담당자" 한 줄(펼치기 가능), 남은 단계는 제목만.
4. **중복 정리**: "상황 요약의 다음 조치 제안 / 가장 적합한 CCTV / 대응 1단계"를 상황 카드 한 곳으로.
5. **안내 문구**는 패널 맨 아래 한 줄 + ⓘ. 실제 경고(분석 실패, 카메라 연결 불가, 분석 당시 반경≠현재 반경)는 본문에.
6. (디자인만 먼저 제안) 왼쪽 목록 위 "긴급 / 처리 중 / 완료" 필터 탭. 상단 긴급 배너(`components/urgent-banner.tsx`)는 유지.

지킬 것:
- 기존 기능은 없애지 말고 탭으로 옮긴다(버튼·링크·API 호출·기록 동작 그대로). 서버·API·DB 변경 없음.
- `/live`(`components/live-wall.tsx`)는 범위 밖. `report-guidance.tsx`는 `/live`에서도 compact 모드로 쓰이므로 깨지지 않게.
- 색은 `app/globals.css` `:root` 토큰만(chart #eef3f1, surface #fff, ink #0f2a3d, ink-soft #4b6271, rule #c5d3cf, beacon #e2580b,
  tide #0d7f81, signal #dc2626, amber #a86a12). 상태색 4개: 빨강=긴급, 주황=진행 중, 청록=완료, 회색=해당 없음.
- 글꼴: IBM Plex Sans KR(본문), IBM Plex Mono(숫자·ID), Black Han Sans(큰 제목만).
- **둥근 모서리·그림자·그라데이션·알약 배지 금지.** 사용자가 "둥글둥글하고 AI 티 나는" 디자인을 싫어한다. 직각, 1px 선, 제목 아래 진한 선.
- 탭은 `role="tablist"/"tab"/"tabpanel"`, 화살표 키 이동. 1366×768에서 가로 넘침 없음.
- 공공 CCTV는 위치정보만이고 영상은 열람·분석하지 않는다는 사실을 최소한 ⓘ에 남긴다.

## 5. 검증 (구현 단계)

- `notebook-b/admin-web`: `npx tsc --noEmit -p .`, `npx eslint components lib tests`(오류 0, 기존 경고 2), `npx next build`.
- B 서버 테스트(서버를 안 바꿨어도 확인용): `notebook-b/central-server`에서
  `C:\Users\user\Desktop\ahfzk\cctv\notebook-b\central-server\.venv\Scripts\python.exe -m pytest -q` → 118 passed가 기준.
- 화면 검사(합성 응답, 3000번에 새 빌드가 떠 있어야 함). 저장소 루트에서:
  `npx --yes --package @playwright/cli playwright-cli -s=ui open http://127.0.0.1:3000`
  `npx --yes --package @playwright/cli playwright-cli -s=ui --raw run-code --filename=notebook-b/admin-web/tests/response-ui.js` (현재 24/24)
  `... --filename=notebook-b/admin-web/tests/guidance-ui.js`
  탭 구조에 맞게 선택자를 고치되 항목을 줄이지 않는다. 탭 전환·화살표 키, 실행 기록 뒤 "다음 할 일" 변경 검사를 추가한다.
- 1920×1080, 1366×768 캡처를 `output/playwright/`에 남기고 직접 본다.
- 3000 재시작: 명령줄에 `cctv-app`이 있는 `next start` 프로세스(와 부모 cmd)만 종료하고, `notebook-b/admin-web`에서
  `npx next start -p 3000 -H 127.0.0.1`을 세션과 분리해(Start-Process 등) 띄운다. **8000(B)은 건드리지 않는다.**

## 6. 규칙 (AGENTS.md 요약 + 사용자 지시)

- `.env`, `runtime/`, `secrets.json`, `cameras.json`, 녹화·영상·로그는 커밋하지 않는다. 토큰을 코드·커밋·검증 결과에 쓰지 않는다.
- 공유 API를 바꾸면 `shared/API.md`에 먼저 기록(이번 작업은 API 변경 없음).
- A 코드·A 시작 스크립트를 건드리지 않는다. 공공 CCTV 영상은 접근·분석하지 않는다.
- 커밋 메시지는 개인정보 없이. 합성 응답 검사는 "합성 응답 검사"라고 명시. 모의 결과를 실제 성공으로 보고하지 않는다.
- 다른 작업자의 변경을 덮어쓰지 않는다. 시작 전 `git status`/`git log -3`으로 확인.
