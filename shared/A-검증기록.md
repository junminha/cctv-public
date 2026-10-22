# A 실제 검증 기록

2026-10-22, 실제 A 노트북, 내장 HD Webcam 1대 + SNAP U2 2대. B/AI 없이 수행.

- `python notebook-a/cctv-base/tests.py`: 6개 통과 (카메라 ID 경계·timezone·duration·녹화 파일 증거·소수점 시간 범위·치명적 오류 전파).
- `python notebook-a/cctv-adapter/tests.py`: 4개 통과 (인증·카메라 조회·잘못된 추출 차단·실제 영상 추출/다운로드 SHA256 일치).
- `python notebook-a/cctv-base/verify.py --min-seconds 600`: 3채널 각각 605.99 / 610.96 / 614.96초 연속 구간을 확인. 각 채널의 RTSP 영상과 과거 MP4를 실제 FFmpeg 디코딩 성공. 상세는 `A-검증.json`.
- Playwright 브라우저: 세 live video 모두 1280×720, readyState 4, 재생 시간 증가. 검색 후 과거 영상도 readyState 4, 1280픽셀 폭, 재생 시간 증가 확인.
- Adapter 중지 후 4초 동안 base 세 채널 모두 online 유지, 수신량 각각 약 1MB 증가. Adapter 없는 base 독립 동작 확인.
- Windows 자식 프로세스 Job 할당 성공 확인. 최초 연속 녹화 검사는 초기 supervisor 버전에서 수행했으며, 이후 오류 전파·녹화 파일 증거·Job 관리 코드를 보완했다.
- 보완 버전에서 cam-02의 FFmpeg만 강제 종료: 7초 후 online 복구 및 restarts=1 확인. cam-01/03은 online 및 restarts=0 유지.
- 보완 버전 base 프로세스 강제 종료: 소유 자식 프로세스가 Windows Job에 의해 모두 종료된 것을 확인. 이후 다시 실행 성공.
- `CCTV_MIN_FREE_GB=99999`로 실제 여유 공간보다 높은 하한을 설정한 시험: disk_low=true, 모든 캡처 offline 확인. 정상 종료 API로 정리하고 기본 10GiB 설정으로 재실행. 실제 디스크를 가득 채우는 시험은 수행하지 않았다.
- 파일명에 timezone을 명시하도록 기존 A 녹화 파일을 변경했으며 변경 전후 SHA256을 비교해 영상 바이트가 변하지 않았음을 확인했다. 모든 경로가 A의 recordings 내부임을 검사했다.
- 최종 정상 재시작 후 같은 통합 검사를 다시 통과했다. 보존된 최장 연속 구간은 634.99 / 635.96 / 635.96초이며 현재 프로세스는 별도 시작 시각을 가진다. 최종 브라우저 3채널 모두 1280×720, readyState 4 및 재생 시간 증가 확인. 최장 연속 구간과 현재 프로세스 가동시간은 서로 다른 지표다.
- 독립 코드 검토에서 발견된 치명적 오류 전파·녹화 증거·relay 중복 시작·소수점 시간 비교 문제를 수정했고 재검토에서 추가 차단급 결함은 발견되지 않았다.

미수행: USB 물리적 탈착/포트 이동, 실제 재부팅, 장시간 부하, 디스크 물리적 장애, B/외부 인터넷 연결, AI. 프로세스 종료 시험은 물리적 장치 고장 시험을 대체하지 않는다.

## A Tailscale 자체 연결 시험

- A 로그인 Running 및 Tailscale IPv4 할당 확인. 현재 peer 없음.
- `192.0.2.10:8555`에 별도 RTSP relay를 바인딩. A 자신이 해당 주소에 인증해서 cam-01/02/03 각각 2초 FFmpeg 디코딩 성공. 무인증 RTSP는 401 응답 확인.
- 실사용하지 않는 Media-over-QUIC(MoQ)가 기본 활성화되어 base/relay 사이 8892 포트 충돌을 일으키는 것을 발견. 양쪽 설정에 `moq: false` 추가 후 정상 시작 확인.
- TCP 리스너 점검: base의 8554/8765/8888/9996/9997 및 Adapter 8766은 127.0.0.1, relay 8555만 Tailscale IPv4에 바인딩. 8892 리스너 없음.
- 변경 후 base 6개·Adapter 4개 테스트 통과.
- HTTPS Serve 활성화 완료. A 자신이 `https://notebook-a.example.invalid`에 접속해서 시스템 인증서 검증 성공, 무인증 health=401, 인증된 health/cameras/capabilities/stream/recordings=200 확인. 세 카메라 online/recording 확인. B/외부망 수신은 미검증.
- HTTPS로 실제 3초 녹화 추출 후 인증 다운로드 수행, 응답 SHA256과 다운로드 파일 해시 일치 확인.

## 관제 화면 디자인 변경 검증

- `frontend-design` 적용: 청회색 바탕/흰 조작부/파란 강조, 실제 영상 중심 배치. API·캡처·녹화 프로세스 변경 없이 HTML/CSS/화면 스크립트만 수정.
- Playwright로 1440×1080 / 1366×768 / 390×844 화면 캡처 및 육안 점검. 노트북 집중 보기에서 세 카메라가 화면 안에 배치되며 모바일 문서 폭은 뷰포트와 같은 390px으로 가로 넘침 없음.
- 전체 보기 전환, USB 카메라를 집중 보기로 선택, 시스템 정보 창 열기와 Escape 닫기 확인.
- 실제 녹화 검색 후 선택 영상 readyState=4, 폭1280, currentTime 증가 및 MP4 저장 링크 표시 확인.
- 실제 자료가 없는 미래 시간 검색은 0개 구간과 시간/카메라 변경 안내 표시. 미선택 상태의 재생 안내 복원 확인.
- `python notebook-a/cctv-base/tests.py`: 6개 통과. 서비스 재시작 없이 화면 적용, 실제 카메라 연결·녹화 유지.
- 스크린샷에는 실제 카메라 영상이 포함되므로 로컬 ignored `output/playwright`에만 저장했다.
