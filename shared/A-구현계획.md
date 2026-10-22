# A 노트북 실행 계획

기준: ../../cctv 최종.md 및 사용자가 승인한 하드웨어별 구조와 1→2→3단계 실행 순서.
사용 장치: HD Webcam 1대, SNAP U2 2대. B 및 AI 없이 동작.

- [ ] 1. 도구 설치와 DirectShow 고유 경로 등록. 같은 이름의 USB 카메라를 숫자 인덱스로 구분하지 않는다. 포트 이동으로 경로가 바뀌면 자동 재배정하지 않고 재등록한다.
- [ ] 2. FFmpeg 채널별 독립 프로세스 → MediaMTX RTSP/TCP. 로컬 웹에서 세 영상을 동시 표시한다.
- [ ] 3. MediaMTX fMP4 연속 녹화(60초 세그먼트, 1초 part), UTC 경로, 7일 보관. 저장공간 하한 10GB 도달 시 녹화 중지 및 상태 표시. 기존 자료를 공간 확보 목적으로 임의 삭제하지 않는다.
- [ ] 4. 로컬 서버: 상태, 녹화 시간 검색, MP4 재생. 프로세스 장애 시 채널별 재시작. 종료/재시작 스크립트와 선택적 로그인 자동 시작.
- [ ] 5. 별도 Adapter: Bearer 인증, cameras/health/capabilities/stream/recordings/export, 고정된 카메라 ID만 허용. 원본은 유지하고 추출본에 SHA256 및 감사 로그 기록.
- [ ] 6. 실제 3채널 10분 이상 녹화, RTSP 디코딩/과거 재생, 채널 장애 복구, Adapter 중지 중 녹화 유지 확인. 실측 결과를 shared에 기록.
- [ ] 7. Tailscale 설치 여부 확인. 계정 연결 또는 B 장비가 없으면 실제 외부망 검증은 미완료로 명시하고 B 연결 절차 제공.

파일: notebook-a/cctv-base/{app.py,index.html,cameras.json,start.ps1,stop.ps1,register.py,tests.py}; notebook-a/cctv-adapter/{adapter.py,start.ps1}; shared/{A-운영.md,A-검증.json}.
구현은 이 세션에서 직접 진행한다. Python 표준 라이브러리 + FFmpeg + MediaMTX로 구성한다.
검증: python tests.py, 실제 3채널 기록/재생/장애 복구/API 인증·경로 검증. B 외부망 연결은 실제 장비 연결 후 별도 확인.
