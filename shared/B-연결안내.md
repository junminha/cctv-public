# B Codex 연결 안내

1. 같은 Tailscale 계정에 B를 연결한다. 저장소를 pull하고 `AGENTS.md`, `STATUS.md`, `API.md`를 읽는다.
2. A Adapter URL: `https://notebook-a.example.invalid`.
3. RTSP: `rtsp://192.0.2.10:8555/cam-01`, `/cam-02`, `/cam-03`. TCP 전송 필수.
4. A의 로컬 `notebook-a/cctv-adapter/secrets.json`에서 `token`, `rtsp_user`, `rtsp_password`만 B의 로컬 비밀 설정으로 안전하게 전달한다. 이 파일은 GitHub에 없다. 채팅/커밋에 값을 붙이지 않는다.
5. B에서 Bearer 인증으로 `/agent/v1/health`와 `/agent/v1/cameras`를 조회한다. 무인증 요청은 401이어야 한다.
6. RTSP 읽기는 stream API의 URL과 별도로 받은 사용자/암호를 사용한다. B에서 디코딩이 성공해야 원격 수신 검증이 완료된다.
7. A와 B를 다른 인터넷에 연결하고 `tailscale ping <A주소>`로 direct/relay를 기록한다. 영상 지연·프레임·트래픽을 실측한다.

A의 현재 자체 시험: HTTPS 인증·상태·녹화 조회와 RTSP 세 채널 디코딩 성공. B 장비/외부망 시험은 아직 수행하지 않았다.
실제 B는 `notebook-b/central-server`에서 GPU 확인 → FastAPI/DB/인증/작업 상태부터 개발한다. A의 장치 설정을 덮어쓰거나 AI를 A에 설치하지 않는다.
