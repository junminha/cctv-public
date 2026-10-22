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
