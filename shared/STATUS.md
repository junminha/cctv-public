# 협업 인수인계

## 2026-11-03 시연 웹캠을 반경 CCTV 순위에 포함 (`work/b-app`)

- 사용자 결정: 분석 승인된 시연 웹캠도 부산 공개 CCTV와 같은 조건으로 반경 CCTV 개수·적합도 순위·가장 적합한 CCTV·대응 방안에 넣는다.
  계약 `shared/API.md` v0.9. 영상 분석은 계속 웹캠만, 공개 CCTV 영상은 열람·분석하지 않는다.
- 지도: 공개 CCTV는 테두리 없는 빨간 점, 시연 웹캠은 같은 빨간색에 흰 테두리(밝은 지도에서 보이도록 얇은 남색 바깥선). 범례·번호 핀 팝업도 맞춤.
- 함께 바꾼 화면: 오른쪽 위 상태 박스 삭제, 화면의 노트북 A/B 표기 삭제, "신고 관제" 제목 → 첫 화면, 글꼴 Pretendard,
  신고 지점 남색 마름모·남색 점선 반경.
- 실제 검증: B `python -m pytest -q` → **162 passed, 1 skipped**. admin-web tsc·build 통과, eslint 오류 0.
  Playwright(**합성 응답 검사**): response-ui 103/103, guidance-ui 55/55(문구 변경 반영), evidence-ui 29/29, live-wall-ui 168/168.
  웹캠·공개 CCTV·추천 핀이 함께 있는 지도 캡처를 직접 확인. B 8000·관리자 3000 재시작(분석 대기 상태 확인 후).

## 2026-10-26 관리자 증거 보기·미리보기·다운로드 (`work/b-app`)

- 사용자 결정: 관리자 신고 상세에서만 보기·재생·개별 다운로드. `/live`는 기록만 보여주고 증거 뷰어를 넣지 않음.
  증거 삭제 기능·보관 기간 정책·코덱 변환 없음. 계약은 `shared/API.md` v0.8, 계획은 `shared/증거보기-미리보기-계획.md`.
- B: `GET /api/v1/admin/reports/{id}/evidence`(첨부·현재 분석 근거·보존 영상 목록), 파일 정보(`?verify=true` 현재 SHA256),
  썸네일(이미지 축소·영상 첫 프레임, 요청 시 생성), 첨부 `disposition=inline`, 근거 이미지 개별 다운로드, 보존 영상 `/clips/{id}/view`.
  근거 이미지는 현재 분석이 선언한 파일만 제공(분석 대기·실행 중이면 404). 원본 첨부·보존 영상은 저장 해시와 비교 후 제공.
  응답은 `no-store, private`·`nosniff`·`no-referrer`, Range/HEAD 지원. 보기/썸네일/다운로드 감사를 구분해 남긴다(실패한 Range는 기록 안 함).
- 관리자 상세: 신고 내용 탭 "신고자 첨부 자료", CCTV 탭 "분석 근거 자료"(전체), 도구 탭 "보존 영상 자료"(재생·파일 정보·다운로드).
  공통 보기 창(네이티브 모달): 이미지 확대/맞춤, 영상·음성 재생(자동 재생 없음), 이전·다음·Home/End, 구분(원본/분석본/보존 사본),
  촬영 시각(없으면 "촬영 시각 미확인"), 기록 SHA256과 해시 검증(일치/불일치), 원본 다운로드. 기존 증거 묶음 ZIP 유지.
- 관리자 프록시: HEAD, If-Range, ETag·Last-Modified·보안 헤더 전달, 프록시 자체 오류도 캐시 금지.
- Codex가 서버 초안을 만들다 사용량 한도로 멈췄고, Claude가 검토·수정 후 화면·프록시를 마무리했다.
  Codex 검사 중 별도 manifest 조회 화면 항목은 범위에서 빼고(ZIP에 manifest 포함) 여러 구간 Range는 multipart 206으로 허용했다.
- 실제 검증:
  - `notebook-b/central-server`: `python -m pytest -q` → **161 passed, 1 skipped**(Windows 심볼릭 링크 권한).
  - `notebook-b/admin-web`: `npx tsc --noEmit -p .`, `npx next build` 통과, `npx eslint components lib tests` 오류 0(기존 경고 2).
    `node tests/evidence-proxy.js` → 14/14 통과(임시 포트의 실제 Next 프록시 + 합성 B).
  - Playwright(저장소 루트, **합성 응답 검사**): evidence-ui 29/29, response-ui 103/103, guidance-ui 55/55, live-wall-ui 168/168,
    output/wall-test.js 30화면 모두 이상 없음.
  - 실제 B: 최근 신고 증거 목록(첨부 2·근거 7) 조회, HEAD로 `no-store`·Range 지원 확인(감사 기록이 남지 않는 요청만 사용).
- B 8000·관리자 3000을 새 코드로 재시작(분석 대기 상태 확인 후). 실제 브라우저에서 사람이 재생해 보는 확인은 아직이다.

## 2026-10-26 AI 분석 로그 `/live` v2 구현·검증 (`work/b-app`)

- 승인된 Figma `Uxs1vW6PnDdUticcsX9FcJ`의 Live log v2(3:2/3:159/3:312/3:457/3:604/3:639, 메모 6:35)를 구현했다.
  상단 상황 카드(유형·우선순위·결과·선정 웹캠·다음 할 일), 6단계 세로 타임라인, `전체 로그`/`단계 보기`,
  오른쪽 대응/CCTV/분석 자료·모델 탭, 간결한 신고 목록과 신고 없음/연결 끊김 상태를 제공한다.
  분석 중에는 분석 자료·모델, 그 외에는 대응 탭이 기본이며 수동 탭 선택은 상태 변경에도 유지하고 신고 변경 시 초기화한다.
  신고 고정/`자동`, 긴급 배너 소리·보기·확인 기록, 전체 처리 이력·모델·첨부 관찰·CCTV 안내를 유지한다.
- `/live`의 대응은 읽기 전용이며 실행 기록·메모 작성 UI를 숨긴다. 완료·미래 단계의 이유는 펼쳐 볼 수 있다.
  관리자 상세의 기존 기록·확인·종결 UI는 그대로다. 완료 단계 번호는 청록, 진행은 주황, 해당 없음은 회색이며 직각·토큰 색을 유지한다.
  근거 프레임은 Figma 도식 대신 인증 프록시의 `/api/v1/admin/reports/{id}/artifacts/{path}`를 사용한다.
  분석 시작 시각을 `run` 쿼리에 넣어 같은 파일명 재사용 시 브라우저의 이전 60초 캐시를 재사용하지 않게 했고 이미지 실패를 명시한다.
- 실패 원인과 수정: `live-wall-ui.js`의 합성 선정 카메라에 필수 좌표가 빠져 `toFixed` 렌더링 오류 후 7초 대기가 만료됐다.
  합성 스키마를 보완했다. `guidance-ui.js`는 선정 카메라가 옮겨진 상단 상황 카드와 새 탭을 따라가도록 선택자를 바꿨다.
  실제 화면 버그도 수정했다: 대응 탭에서 숨겨지던 수동 반경 변경 경고를 안내 위로 옮겼고, 후보 검색 전 실패를 “웹캠 없음”으로 단정하지 않는다.
  `완료 → 분석 중 → 완료`에서 상세 응답을 지연시키면 이전 완료 키의 캐시가 되살아나는 문제를 **167 PASS/1 FAIL**로 재현했다.
  전환마다 이전 상세를 버리는 단일 결과 상태로 수정한 뒤 같은 회귀 검사가 통과했다. 타임아웃을 늘려 통과시키지 않았다.
- 실제 최종 검증 명령과 결과:
  - `notebook-b/admin-web`에서 `npx tsc --noEmit -p .` → **통과(exit 0)**.
  - 같은 위치 `npx eslint components lib tests` → **오류 0 / 기존 경고 2** (`system-status.tsx:63`, `lib/api.ts:245`).
  - 같은 위치 `npx next build` → **통과(exit 0)**, Next.js 16.4.2, 9개 정적 페이지 생성.
  - 루트에서 `npx --yes --package @playwright/cli playwright-cli -s=live-response-final --raw run-code --filename=notebook-b/admin-web/tests/response-ui.js`
    → **103 PASS / 0 FAIL**, 관리자 기존 검사 유지.
  - 같은 CLI `-s=guidance-debug --raw run-code --filename=notebook-b/admin-web/tests/guidance-ui.js`
    → **55 PASS / 0 FAIL** (기존 53개 유지, 읽기 전용 2개 추가).
  - 같은 CLI `-s=live-debug --raw run-code --filename=notebook-b/admin-web/tests/live-wall-ui.js`
    → **168 PASS / 0 FAIL** (기존 155개 유지, 이미지 실행 구분·지연 상세 전환·초기 실패·미래 단계 등 13개 추가).
  - 같은 CLI `-s=live-wall-final --raw run-code --filename=output/wall-test.js`
    → **30/30 화면 + 신고 선택/자동 복귀 1/1 통과**. 두 해상도 모두 overflow=false, clipped=[], textClip=0, overlap=false, rounded=0, errors=0.
    시각 검사에서 숨김 제목 `.sr-only`와 title이 있는 의도적 말줄임을 구별하도록 로컬 선택자를 조정했다. 시나리오는 줄이지 않았다.
- 위 브라우저 검사는 모두 **합성 응답 검사**다. 결과는 `output/playwright/live-v2-{response,guidance,flow,wall}-results.txt`.
  `live-v2-{1920,1366}-{running,complete,all-log,urgent,expand,empty,offline}.png` 14장과 JPEG가 표시된 `wall-{1920,1366}-review.png`를 직접 확인했다.
  시안과 달리 긴 실제 문구·로그·이미지는 패널 내부에서 스크롤하며 예시 수치·근거 도식을 제품 코드에 넣지 않았다.
- 재시작: 3000 리스너의 명령줄에 `cctv-app`과 `next ... start`가 있는지 확인한 후 해당 PID만 종료했다.
  `Start-Process -FilePath 'cmd.exe' -ArgumentList '/c "npx next start -p 3000 -H 127.0.0.1"' -WorkingDirectory 'C:/Users/user/Desktop/ahfzk/cctv-app/notebook-b/admin-web' -WindowStyle Hidden`
  으로 세션과 분리해 실행했다. 최종 웹 리스너 **PID 36612**, `/login` **200** 확인. B 8000 **PID 21204 유지**, Expo·Tailscale 조작 없음.
  서버·API·DB·A·Figma 변경 없음. 실제 A 영상·휴대폰·외부망 검증은 이번에 수행하지 않았고 `output/`·`runtime/`·`.env`는 커밋하지 않는다.

## 2026-10-26 검색 반경 자동 확대 v0.7 (`work/b-app`)

- Claude가 남긴 API·모델·worker·guidance 미커밋 초안을 검토하고 이어서 완성했다. `cctv 최종.md` §6.2와
  `shared/API.md` v0.7에 따라 승인·온라인·신선도·위치 구분 조건을 통과한 cam-01/02/03 웹캠이 없으면 100m씩 다시 찾는다.
  `expand_steps`는 정수 0~5(기본 2, 자동 분석도 동일), 상한 5000m이며 첫 후보를 찾으면 중단한다.
  신고 저장 반경은 그대로 두고 분석의 후보·근접 순위·공공 CCTV 위치 안내에만 확대 반경을 쓴다.
  `analysis.search`의 시도별 반경·후보 수와 `radius_expanded` 이벤트를 기록한다. 공공 CCTV 영상은 접근·분석하지 않는다.
- 초안 보완: 영상 수신 실패·검색 소진 때도 확대 사실을 주의사항에 남긴다. 후보가 끝까지 없으면 분석에 저장된 기본/최종 반경으로
  “Am에서 Bm까지 넓혀도” 안내한다. 반경 반올림은 표시할 때만 하여 99.6m처럼 소수인 반경을 확대했다고 오안내하지 않는다.
- 관리자 대응/CCTV 탭에 “반경 300m → 500m 자동 확대” 형식의 실제 결과를 표시하고, 도구에 자동 확대 횟수 입력을 추가했다.
  이전 저장 매개변수에는 기본 2회를 병합하며 기존 설정을 유지한다. 빈 값·소수·0~5 밖 값은 실행을 막는다.
  자동 확대와 수동 반경 변경 경고를 구분하고 재분석 중·오래된 결과의 확대 안내는 숨긴다.
  `/live` 처리 기록에는 amber 토큰의 `EXPAND` 태그로 이벤트를 표시한다. 직각·1px 선을 유지했다.
- 실제 검증 명령과 결과:
  - `notebook-b/central-server`에서 `C:\Users\user\Desktop\ahfzk\cctv\notebook-b\central-server\.venv\Scripts\python.exe -m pytest -q`
    → **144 passed / 0 failed**, 77.96초(기존 118개 유지, 26개 추가). 임시 DB·가상 A·합성 클립을 사용하며 실제 시연 DB를 수정하지 않았다.
    확대 시도·이벤트·저장 반경 불변·nearby·순위·첫 후보 중단·0회·소진·5000m 상한·입력 검증·자동 기본값·대응 문구를 검사했다.
  - `notebook-b/admin-web`에서 `npx tsc --noEmit -p .` → 통과(exit 0), `npx eslint components lib tests` → **오류 0 / 기존 경고 2**,
    `npx next build` → 통과(exit 0). 브라우저 검사 문구 수정 후 ESLint도 다시 통과했다.
  - 저장소 루트에서 `npx --yes --package @playwright/cli playwright-cli -s=expand-response --raw run-code --filename=notebook-b/admin-web/tests/response-ui.js`
    → **103 PASS / 0 FAIL**(기존 91개 보존), 페이지 오류 0.
  - 같은 CLI의 `-s=expand-guidance --raw run-code --filename=notebook-b/admin-web/tests/guidance-ui.js`
    → **53 PASS / 0 FAIL**(기존 11개 보존), 페이지 오류 0. 확대 표시·amber 로그·입력 전송·이전 기록 호환·재분석 최신성·경고 구분을 추가했다.
  - 같은 CLI의 `-s=expand-wall --raw run-code --filename=output/wall-test.js`
    → **30/30 화면 시나리오 + 신고 선택/자동 복귀 1/1 통과**. 두 해상도 모두 overflow=false, clipped=[], textClip=0, overlap=false, rounded=0, errors=0.
- 재시작: 지정된 `C:\Users\user\.claude\jobs\cc7a2432\tmp\st.py`를 메인 venv Python으로 실행해 `current_report_id=None`을 확인한 경우만
  `& "C:\Users\user\.claude\jobs\cc7a2432\tmp\restart.ps1"`을 실행했다. 기존 환경·DB 경로를 유지한 cctv-app 코드의 8000/3000 재시작 완료.
  `/health` **200**, 인증 없는 `/live` **307**, 실행 중 OpenAPI의 expand_steps 정수·0~5·기본2 확인. 새 리스너 PID: B **21204**, 웹 **31912**.
  토큰·환경파일 내용은 출력·기록하지 않았으며 Expo·Tailscale은 조작하지 않았다.
- 위 화면 검사는 모두 **합성 응답 검사**다. 결과: `output/playwright/expand-{response,guidance,wall}-results.txt`.
  캡처 `output/playwright/expand-{1366,1920}-{response,cctv,live,tools}.png` 8장과 `/live` 기존 시나리오 캡처를 직접 확인했다.
  실제 A 웹캠·휴대폰·외부망을 통한 자동 확대 분석은 이번 작업에서 수행하지 않았다. `output/`·`runtime/`·`.env`는 커밋하지 않는다.

## 2026-10-26 관리자 상황판 v2 구현·검증 (`work/b-app`)

- 추가 요청(2026-10-26): 지도 범례만 본문 12→11px·줄높이 18→14.85px·여백 세로8/가로12→세로6/가로8px·항목 간격4→2px·색 표시10→8px·번호 칸18→14px로 축소(실측 약243×130px); 항목 4개·공개 CCTV 체크박스 켜기/끄기·표 번호 칸18px 유지 확인. `npx tsc --noEmit -p .`, `npx eslint components lib tests`(오류0/기존 경고2), `npx next build` 통과, 3000만 재시작(8000 PID18484 유지), 루트의 `npx --yes --package @playwright/cli playwright-cli -s=legend --raw run-code --filename=notebook-b/admin-web/tests/response-ui.js` 합성 응답 검사 91 PASS/0 FAIL; `output/playwright/legend-1366-console.png` 직접 확인.
- 승인된 Figma `Admin console v2` (44:261 / 44:334 / 44:407 / 44:480 / 44:553)를 관리자 웹에 구현했다.
  상단 독립 긴급 배너(기존 알림음·확인 기록·보기 동작 유지), 신고 목록 긴급/처리 중/완료 필터,
  대응/CCTV/신고 내용/도구 탭과 좌우 화살표·Home·End 키 이동을 제공한다. 신고를 바꾸면 대응 탭으로 돌아가며 탭 전환 시 입력은 유지한다.
- 상황 카드의 우선순위는 이번 분석의 대응 계획, 없으면 스냅샷 우선순위다. 다음 할 일은 이번 `finished_at` 이후 실행 기록이 없는 첫 단계다.
  완료 단계는 다시 펼칠 수 있고, 현재 단계만 근거·실행 기록을 펼치며 미래 단계는 제목만 표시한다.
  재분석 중·실패 후 이전 결과가 남았을 때 상세와 지도 모두 이전 선정·순위를 숨긴다.
- CCTV 탭은 카메라별 실제 순위·근거 썸네일과 공공 CCTV 간결한 추천을 표시한다. 좌표·용도·추천 이유는 지도 번호 핀에서 확인한다.
  신고문·위치·첨부·음성 전사·요약, 반경·분석 매개변수·비교·보존·ZIP·전체 처리 기록·확인·종결 기능을 각 탭에 보존했다.
  공공 CCTV 영상은 열람·분석하지 않는다. 서버·API·DB·A 코드는 변경하지 않았다. Figma 파일도 변경하지 않았다.
- 시안과의 차이: 긴 실제 문구·기록은 고정 높이로 자르지 않고 상세 패널 안에서 스크롤한다. 비교 실험은 기존 방식 선택과 분석 실행 흐름을 유지한다.
  지도 신고 지점·반경은 색 토큰 제한에 맞춰 기존 보라색 대신 `beacon` 주황색을 사용한다. 예시 수치·이미지는 제품 코드에 넣지 않았다.
- 실제 검증 명령과 결과:
  - `notebook-b/admin-web`: `npx tsc --noEmit -p .` → 통과(exit 0).
  - 같은 위치: `npx eslint components lib tests` → 오류 **0**, 기존 경고 **2** (`system-status.tsx`, `lib/api.ts` 로그인 이동).
  - 같은 위치: `npx next build` → 통과(exit 0). 초기 Turbopack 캐시에 이전 CSS가 남아 새 규칙이 빠진 것을 산출물로 확인했다.
    이 worktree의 `.next/cache`만 `.next/cache-before-admin-v2`로 보관 후 재빌드해 새 CSS 포함을 확인했다. 설정 파일은 바꾸지 않았다.
  - `notebook-b/central-server`: `C:\Users\user\Desktop\ahfzk\cctv\notebook-b\central-server\.venv\Scripts\python.exe -m pytest -q`
    → **118 passed**, 76.76초. 8000 서버 재시작 없이 수행했다.
  - 관리자 3000: 명령줄의 `cctv-app` 경로·`next start`·3000 포트를 확인한 해당 프로세스와 부모 cmd만 종료하고,
    `notebook-b/admin-web`에서 `npx next start -p 3000 -H 127.0.0.1`을 `Start-Process -WindowStyle Hidden`으로 분리 실행했다.
    `/login` HTTP 200 확인. B 8000 리스너 PID **18484**는 시작 전·후 동일하며 Expo·Tailscale은 조작하지 않았다.
  - 저장소 루트: `npx --yes --package @playwright/cli playwright-cli -s=ui --raw run-code --filename=notebook-b/admin-web/tests/response-ui.js`
    → **91 PASS / 0 FAIL**, 페이지 오류 0. 기존 24개 항목을 보존하고 탭·ARIA·키보드·다음 할 일·이전 분석 기록·3개 목록 필터·요청 전 분석 시작 검사를 추가했다.
  - 저장소 루트: `npx --yes --package @playwright/cli playwright-cli -s=guidance --raw run-code --filename=notebook-b/admin-web/tests/guidance-ui.js`
    → **11 PASS / 0 FAIL**, 페이지 오류 0. 1920/1366 상세·`/live`, 반경 저장, 빈/이전 형식 결과, 오류/재시도,
    지연 신고 전환, 미래 단계 조작 차단, 재분석 중 지도 순위 제거, 실행 중/실패 후 결과 최신성을 확인했다.
  - 저장소 루트: `npx --yes --package @playwright/cli playwright-cli -s=wall --raw run-code --filename=output/wall-test.js`
    → **30/30 화면 시나리오 + 신고 선택/자동 복귀 1/1 통과**. 두 해상도에서 overflow=false, clipped=[], textClip=0, overlap=false, errors=0.
    오래된 이 스크립트의 `/nearby` 모의 응답이 신고 상세를 반환하던 문제만 최신 계약 형태로 보완했다. `output/`은 커밋하지 않는다.
- 위 Playwright 결과는 모두 **합성 응답 검사**다. 캡처는 `output/playwright/admin-v2-{1920,1366}-{response,cctv,report,tools,pending}.png` 10개,
  `guidance-*.png`, `response-*.png`, `wall-*.png`이며 직접 열어 배치·겹침·잘림을 확인했다. 결과는 `admin-v2-response-results.txt`, `admin-v2-guidance-results.txt`에도 남겼다.
  실제 A 웹캠 AI 분석·OpenAI 호출·실제 알림음 청음·휴대폰·외부망 검증은 이번 작업에서 수행하지 않았다.

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
