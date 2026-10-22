# A 노트북 운영

## 시작과 중지

프로젝트 루트에서 `powershell -ExecutionPolicy Bypass -File notebook-a/cctv-base/start.ps1`.
화면 http://127.0.0.1:8765. 중지 `powershell -ExecutionPolicy Bypass -File notebook-a/cctv-base/stop.ps1`.
모든 AI/B/Adapter가 없어도 동작한다. 모니터를 닫거나 절전 모드에 들어가면 녹화가 멈추므로 전시 중 전원 연결과 Windows 절전 설정을 확인한다.

선택적 로그인 자동 시작: `notebook-a/cctv-base/enable-autostart.ps1` 실행.
해제: `Unregister-ScheduledTask -TaskName CCTV-Notebook-A -Confirm:$false`.
장비 재부팅 후 로그인해야 시작되며 사용자 카메라 권한이 필요하다. 실제 재부팅 검증은 별도 수행한다.

## 카메라

내장 HD Webcam + SNAP U2 2대. 장치의 MJPEG 1280×720 30FPS 입력을 10FPS H.264 약 1.5Mbps로 인코딩한다. 음성은 녹음하지 않는다.
실제 지원 모드를 FFmpeg로 조회해 선정했다. 다른 카메라에서는 register.py 설정을 지원 모드에 맞춘다.
같은 USB 포트를 유지한다. 장치를 찾지 못하면 해당 채널만 재시도한다. 포트 변경 시 `cameras.json`의 해당 장치 경로를 확인해 명시적으로 재등록한다. 다른 카메라를 자동으로 대신 연결하지 않는다.

## 녹화와 저장공간

원본: `notebook-a/cctv-base/recordings/{camera}/`. 60초 fMP4, part 약 1초. 비정상 종료 시 마지막 part 손실 가능.
MediaMTX의 Windows 파일명은 현지 시간이며 timezone을 포함한다. API는 UTC, 화면은 한국 시간이다. Windows 시간 자동 동기화를 켠다.
기본 보관은 7일이며 MediaMTX가 기간 만료된 원본을 삭제한다. 별도 추출 보존본은 자동 삭제하지 않는다.
10GiB 미만이면 캡처·녹화를 중지하고 경고한다. 공간이 회복되면 재시작한다. 공간 확보를 위해 최신 자료를 임의 삭제하지 않는다.
검증용 `CCTV_MIN_FREE_GB`로 하한을 조절할 수 있다. 기록 용량은 촬영 장면에 따라 달라진다.
현재 녹화 중인 세그먼트는 검색에 바로 표시되지 않을 수 있다. 파일을 직접 이동하거나 수정하지 않는다.
로그: `cctv-base/logs`. 카메라 장애와 MediaMTX 장애는 재시도한다. 전체 base는 시작 스크립트/로그인 예약 작업으로 다시 실행한다.

## Adapter / B 연결

1. `powershell -ExecutionPolicy Bypass -File notebook-a/cctv-adapter/start.ps1`.
2. A와 B에 Tailscale을 설치하고 같은 tailnet에 로그인한다. A 토큰·RTSP 암호는 `cctv-adapter/secrets.json`에서 별도 안전한 경로로 B에 전달한다.
3. A에서 `python notebook-a/cctv-adapter/network.py`로 Tailscale 주소에만 RTSP relay를 시작한다. Adapter를 재시작해 설정을 반영한다.
4. `& 'C:\Program Files\Tailscale\tailscale.exe' serve --bg --https=443 http://127.0.0.1:8766`.
5. 출력된 HTTPS URL과 `shared/API.md`로 B가 접속한다. Tailscale ACL에서 B의 A 접근을 제한한다. Funnel/공유기 포트포워딩은 사용하지 않는다.
6. B에서 `tailscale ping <A주소>`로 direct/relay 여부를 확인하고, 다른 인터넷에서 실제 수신을 측정한다.

Adapter/relay 중지: `notebook-a/cctv-adapter/stop.ps1`. HTTPS relay 해제: `tailscale serve reset` (해당 컴퓨터의 다른 Serve 설정도 제거하므로 현재 설정을 확인).
Adapter 파일을 제거해도 base는 동작한다. B가 없으면 원격 연결이 완료됐다고 판단하지 않는다.

## 검증

`python notebook-a/cctv-base/tests.py` (입력 경계), `python notebook-a/cctv-base/verify.py` (실제 3채널 10분 녹화·RTSP·과거 영상 디코드).
`shared/A-검증.json`은 검사 시점의 결과다. USB 실제 탈착·컴퓨터 재부팅·디스크 물리적 고장·다른 인터넷 수신은 각각 실제로 시험해야 한다.

공식 참고: [FFmpeg DirectShow](https://ffmpeg.org/ffmpeg-devices.html#dshow), [MediaMTX 녹화](https://mediamtx.org/docs/features/record), [재생](https://mediamtx.org/docs/features/playback), [인증](https://mediamtx.org/docs/features/authentication).
