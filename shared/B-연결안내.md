# B Codex 연결 안내

1. 같은 Tailscale 계정에 B를 연결한다. 저장소를 pull하고 `AGENTS.md`, `STATUS.md`, `API.md`를 읽는다.
2. A Adapter URL: `https://notebook-a.example.invalid`.
3. RTSP: `rtsp://192.0.2.10:8555/cam-01`, `/cam-02`, `/cam-03`. TCP 전송 필수.
4. A의 로컬 `notebook-a/cctv-adapter/secrets.json`에서 `token`, `rtsp_user`, `rtsp_password`만 B의 로컬 비밀 설정으로 안전하게 전달한다. 이 파일은 GitHub에 없다. 채팅/커밋에 값을 붙이지 않는다.
5. B에서 Bearer 인증으로 `/agent/v1/health`와 `/agent/v1/cameras`를 조회한다. 무인증 요청은 401이어야 한다.
6. RTSP 읽기는 stream API의 URL과 별도로 받은 사용자/암호를 사용한다. B에서 디코딩이 성공해야 원격 수신 검증이 완료된다.
7. A와 B를 다른 인터넷에 연결하고 `tailscale ping <A주소>`로 direct/relay를 기록한다. 영상 지연·프레임·트래픽을 실측한다.

A의 자체 시험: HTTPS 인증·상태·녹화 조회와 RTSP 세 채널 디코딩 성공. 이후 B 검증 결과는 아래와 `B-검증기록.md`를 참고한다.
실제 B는 `notebook-b/central-server`에서 개발한다. A의 장치 설정을 덮어쓰거나 AI를 A에 설치하지 않는다.

## A에서 B로 전달한 정보 (2026-10-22)

- A와 같은 계정의 `notebook-b-example` (`192.0.2.11`) 장치 online 확인. Tailscale ping은 direct 경로로 약 3ms 응답. 이 결과는 API/RTSP 포트별 허용이나 다른 인터넷 시험을 대신하지 않는다.
- `token`, `rtsp_user`, `rtsp_password`만 포함한 `a-secrets.json`을 해당 장치로 Tailscale Taildrop 전송 완료(명령 종료 코드 0). 파일 내용은 GitHub나 채팅에 표시하지 않았다.
- B 담당은 Taildrop 수신 파일을 확인해서 **B 저장소**의 `notebook-b/central-server/runtime/a-secrets.json`에 저장한다. CLI 수신 시 `tailscale file get <수신할 실제 폴더>`를 사용한다. 같은 이름의 기존 파일은 확인 없이 덮어쓰지 않는다.
- 현재 장치가 같은 tailnet에서 online으로 보이며 승인 대기 징후는 없다. 관리자 ACL 정책 자체는 A CLI에서 조회하지 않았다. B에서 A의 TCP 443/8555 접속을 시험하고, 정책이 차단하면 해당 B→A 경로만 허용해야 한다.

| 카메라 | 장치 / 구분 | 실제 위치·시연 구역 | 영상 분석 승인 |
|---|---|---|---|
| cam-01 | 내장 전면카메라 / 웹캠 데모 | 사용자 확인 대기 | 촬영 대상 동의·승인 미등록 |
| cam-02 | USB 카메라 1 / 웹캠 데모 | 사용자 확인 대기 | 촬영 대상 동의·승인 미등록 |
| cam-03 | USB 카메라 2 / 웹캠 데모 | 사용자 확인 대기 | 촬영 대상 동의·승인 미등록 |

공공 CCTV 좌표나 촬영 대상 동의 여부를 임의로 입력하지 않는다. 위치·승인 정보는 사용자가 확인하면 갱신한다. 연결 구현·상태 조회와 이 메타데이터 확인은 구분한다.

## B 수신·접속 확인 (2026-10-22)

- Taildrop 수신 `a-secrets.json`을 B 로컬 runtime에 저장했다. 파일의 비밀 값은 출력/커밋하지 않았다.
- B에서 TCP443/8555 접속 성공, 인증서 검증 유지한 HTTPS 무인증 health401·인증 health/cameras/capabilities200 확인.
- B FastAPI를 통한 실제 A health·카메라 동기화도200. 세 채널을 DB에 저장하되 위치 null·분석 승인 false 유지.
- Tailscale ping direct 응답 약26ms. 다른 인터넷/영상 지연 시험이 아니다.
- 실제 프레임 읽기·영상 분석·보존은 아직 수행하지 않았다. 위치·촬영 대상 동의/분석 승인을 받은 뒤 진행한다.
- 공개 카탈로그는 부산시 공식 원문으로부터 정제한 위치 데이터다. A의 웹캠 위치와 구분하며 모든 공개 항목은 analysis_available=false다.
