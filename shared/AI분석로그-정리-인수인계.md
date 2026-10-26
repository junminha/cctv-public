# AI 분석 로그(/live) 화면 정리 — Codex 인수인계 (2026-10-26)

Claude Code 세션에서 Codex로 넘기는 작업이다. 이 문서와 `AGENTS.md`, `shared/STATUS.md` 맨 위 항목들,
`shared/관리자UI-정리-인수인계.md`(같은 방식으로 끝낸 관리자 화면 작업), `shared/API.md` v0.5~v0.7을 먼저 읽는다.

## 1. 사용자 요청과 진행 순서

사용자 말: "AI 분석 로그 화면도 관리자 화면처럼 좀 더 정보를 편하게 볼 수 있게 수정하고 싶음. codex한테 figma로 수정사항 적용해서
만들어보라하고 내가 승인하면 실제로 구현할 수 있도록".

1. **Figma 시안 먼저**(지금 단계). 저장소 코드 변경 없음.
2. 사용자 승인 후 **구현** → 3. 검증·`shared/STATUS.md` 기록·`work/b-app` 커밋·푸시. 승인 전에는 코드를 고치지 않는다.

## 2. 현재 화면

- 주소 `http://127.0.0.1:3000/live`, 코드 `notebook-b/admin-web/components/live-wall.tsx`(+ `report-guidance.tsx` compact 모드,
  `urgent-banner.tsx`), 스타일 `app/globals.css`의 `.wall` 절. 제목 "AI 분석 로그". 전시장 큰 화면(1920×1080)이 주 용도.
- 구성: 맨 위 제목·LIVE·시계, 긴급 배너(긴급 신고가 있을 때), 3열
  - 왼쪽 "신고": 최근 신고 목록, 클릭하면 고정, "자동"은 분석 중인 신고를 따라감. 긴급 신고는 맨 위·긴급 표시.
  - 가운데: 선택 신고 제목, 6단계 띠(접수·분류·반경 후보·저FPS 탐색·집중 분석·요약), 시간순 로그
    (태그 RECEIVED/QUEUE/CLASSIFY/CANDIDATES/SCAN/FOCUS/SUMMARY/VOICE/PHONE/WARN/DONE/EXPAND/LOG/REVIEW, 경과 초).
  - 오른쪽 "분석 기록": 방식(분석·영상·프레임), 자동 확대 문구, 반경 안 CCTV(웹캠·공공 개수, 접힌 목록), 가장 적합한 CCTV,
    대응 방안, 사용한 모델(분류·전사·YOLO·자세·장치·보고서), 분석 자료(TEXT/PHOTO/VOICE/CAM-xx 행, 근거 썸네일).
- 현재 캡처: `output/playwright/expand-1920-live.png`, `expand-1366-live.png`(git 밖 산출물).
- 문제: 오른쪽 열이 길게 이어져 대응 방안·분석 자료가 화면 아래로 밀리고 스크롤해야 보인다. 가운데 로그 칸은 대부분 비어 있다.
  같은 내용(가장 적합한 CCTV·분석 자료의 CAM 행·로그의 FOCUS 줄)이 여러 곳에 흩어져 있다. 지금 무엇을 하는 중인지 한눈에 안 보인다.

## 3. 디자인 방향(제안, 시안에서 다듬어도 됨)

1. **상단 상태 줄**(선택 신고): 사건 유형, 우선순위, 현재 단계와 경과 시간(분석 중) 또는 결과(완료), 가장 적합한 CCTV, 다음 할 일 1줄.
2. **가운데 = 진행 타임라인**: 6단계를 세로 타임라인으로 펼치고 각 단계 안에 해당 로그 줄과 핵심 수치(후보 카메라 수, 처리 프레임, 관련도,
   찾은 장면)를 넣는다. 진행 중인 단계를 강조. 집중 분석에서 찾은 근거 프레임은 가운데에 크게(전시 효과). 확대·경고·대응 기록 줄도 시간순 유지.
3. **오른쪽 = 짧은 요약 + 탭**: 탭 예) 대응 / CCTV / 분석 자료·모델. 분석 중에는 분석 자료, 끝나면 대응 탭이 기본.
   관리자 화면(`Admin console v2`)과 같은 탭·상황 카드 언어를 쓴다.
4. 왼쪽 신고 목록은 더 촘촘하게(시각·유형·상태 색 막대), 긴급 맨 위 유지.
5. 멀리서 읽히게: 1920×1080에서 본문 크기 유지, 숫자는 크게. 1366×768에서도 넘치지 않게.
6. 신고 없음, 분석 대기, 연결 끊김 상태도 정리.

지킬 것:
- 기능 손실 금지(신고 고정/자동, 긴급 배너 보기·확인, 로그 전부, 대응 방안·CCTV 안내·모델·분석 자료).
- 색은 globals.css 토큰(관리 화면과 같은 밝은 팔레트). 상태색 4개: 빨강=긴급, 주황=진행 중, 청록=완료, 회색=해당 없음.
- 글꼴: IBM Plex Sans KR(본문), IBM Plex Mono(숫자·ID·로그 태그), Black Han Sans(큰 제목만). 한글을 Mono 글꼴로 쓰지 않는다.
- **둥근 모서리·그림자·그라데이션·알약 배지·빛나는 효과 금지.** 사용자가 "둥글둥글하고 AI 티 나는" 디자인을 싫어해 /live를 직각 로그 기록지로 바꿨다.
- 공공 CCTV는 위치정보만이고 영상 미분석이라는 사실은 최소 한 줄/ⓘ로 남긴다. 시연 영상 입력은 웹캠 cam-01/02/03만.

## 4. Figma

- fileKey `NCoiCSwtK24eopChRoFtBz`. 기존 페이지(Screens, Components, Reporter tokens, Admin console v2) **수정 금지**.
  새 페이지 **"Live log v2"** 안에서만 작업. Admin console v2의 공통 요소는 복제해 써도 된다.
- 프레임(1920×1080): ① 분석 진행 중(저FPS 탐색 단계, 웹캠 3대 탐색) ② 분석 완료·관련 장면 후보(근거 프레임, 대응 방안)
  ③ 긴급 신고 도착·분석 대기 ④ 반경 자동 확대 후 결과(관련 장면 없음) ⑤ 신고 없음 + 연결 끊김. 그리고 ②의 1366×768 판.
  현재 화면 캡처를 "현재(before)" 프레임으로 둔다.
- 실제 문구·태그 사용. 끝나면 get_screenshot으로 겹침·잘림 확인, 프레임 링크(node-id)를 남기고 **사용자 승인을 기다린다.**

## 5. 구현·검증 (승인 후)

- 대상: `live-wall.tsx`, 필요 시 `report-guidance.tsx`(관리자 상세와 공유 — 관리자 화면이 깨지지 않게), `urgent-banner.tsx`, `globals.css`.
  서버·API 변경 없음(필요하면 먼저 `shared/API.md`에 기록하고 사용자에게 알린다).
- 검증: admin-web `npx tsc --noEmit -p .`, `npx eslint components lib tests`(오류 0), `npx next build`;
  저장소 루트에서 Playwright `output/wall-test.js`(현재 30화면+선택), `notebook-b/admin-web/tests/response-ui.js`, `guidance-ui.js`
  (선택자 수정 가능, 항목 감소 금지, 새 구조 검사 추가), 1920·1366 캡처 직접 확인. 합성 응답 검사임을 명시.
- 3000 재시작만(명령줄에 cctv-app이 있는 next start). 8000(B)·Expo·Tailscale은 건드리지 않는다.
- `shared/STATUS.md` 기록, `work/b-app` 커밋·푸시(`Co-Authored-By: Codex <noreply@openai.com>`). output/·runtime/·.env 제외.
