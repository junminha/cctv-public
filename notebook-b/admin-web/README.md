# B 관리자 화면 (Next.js)

노트북 B에서 FastAPI(127.0.0.1:8000)와 함께 실행하는 관제 화면이다. Next.js 16 App Router, TypeScript, Tailwind 4, Leaflet.

## 실행

```powershell
powershell -ExecutionPolicy Bypass -File notebook-b/central-server/start.ps1   # 먼저 B 서버
powershell -ExecutionPolicy Bypass -File notebook-b/admin-web/start.ps1        # 다른 창에서
```

http://127.0.0.1:3000 에 접속해 `central-server/runtime/secrets.json`의 admin 토큰으로 로그인한다.
개발 중에는 `npm run dev`. 다른 B 주소를 쓰면 `.env.example`을 `.env.local`로 복사해 수정한다.

## 화면

- **상황판**: 신고 목록, 지도(신고 반경·후보 카메라 순위 점수·선정 카메라, 부산 공개 CCTV 위치), 신고 상세
  (분석 단계, 후보 카메라 순위, 근거 프레임, 상황 요약, 첨부, 비교 실험, 재분석, 사건 영상 보존, 확인 완료·종결, 처리 기록).
  `모의 신고 접수`는 지도에서 지점을 고른 뒤 시민 앱과 같은 API로 접수한다.
- **카메라 등록**: A 상태 가져오기, cam-01~03의 위치·시연 구역·위치 종류 입력, 출연자 동의 확인 후 분석 승인, 승인된 카메라의 현재 화면.
- **성능 비교**: 접수 건수, 분석 요청→결과 지연(중앙값·P95), 선택 분석 vs 전체 분석 처리 프레임, 결과 분포.

## 보안 구조

- admin 토큰은 로그인 시 B에서 검증한 뒤 HttpOnly·SameSite=Strict 쿠키에만 저장한다. 브라우저 JS는 읽지 못한다.
- 모든 B 호출은 같은 출처의 `/api/b/api/v1/...` Route Handler 프록시가 토큰을 붙여 전달한다. `api/v1` 밖의 경로는 거부한다.
- 실시간 갱신은 프록시로 받은 30초 단회 ticket으로 FastAPI WebSocket에 직접 연결한다. URL에 토큰을 넣지 않는다.
- OpenAI 키, A 토큰, RTSP 계정은 이 앱에 없다. 브라우저는 RTSP를 직접 열지 않고 인증된 최근 프레임과 보존 MP4만 받는다.
- 지도 타일은 OpenStreetMap 공개 타일 서버를 쓰므로 인터넷이 필요하다.

## 검증

`npx tsc --noEmit`, `npx eslint .`, `npx next build`. 브라우저 검증 기록은 `shared/B-검증기록.md`.
