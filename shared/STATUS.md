# 협업 인수인계

기준일: 2026-10-22. A/B 공동 인수인계 문서다. B 작업은 **노트북 B**, `work/b-server` 브랜치에서 진행한다.

## 진행 범위

- A: 내장 HD Webcam 1대 + SNAP U2 2대. DirectShow 고유 경로에 cam-01/02/03을 고정 등록.
- A base: FFmpeg → MediaMTX RTSP/TCP, 로컬 3채널 HLS 화면, 연속 fMP4 녹화, 시간 검색·MP4 재생, 공간 하한·채널 재시도·프로세스 관리 구현.
- A 화면은 frontend-design 스킬을 적용해 밝은 관제 화면으로 재구성했다. 선택 카메라 집중 보기/전체 보기/전체 화면, 카메라별 녹화 증거·재접속 표시, 검색 결과 옆 과거 재생, 시스템 정보 창과 모바일 배치를 제공한다. 외부 폰트·아이콘·프런트엔드 패키지 의존성은 없다.
- 별도 Adapter: Bearer 인증, 상태/카메라/녹화구간/추출·SHA256/감사 로그 구현. 별도 Tailscale 전용 RTSP relay 설정 코드 제공.
- 실제 수행한 검증 결과는 `A-검증.json`과 `A-검증기록.md`를 참고한다. 결과 파일이 없거나 항목이 NOT_TESTED라면 완료된 것으로 해석하지 않는다.
- Tailscale 1.104.2 설치 및 A 로그인 확인. A 주소 `192.0.2.10`, 이름 `notebook-a.example.invalid`.
- 인증 RTSP relay가 A Tailscale 주소의 8555 포트에서 실행 중. A 자체 3채널 디코딩·무인증 차단 시험 완료. B `notebook-b-example`이 같은 tailnet에서 연결됐고 B→A TCP443/8555 및 direct ping 성공. B 실제 영상 디코딩/다른 인터넷 수신은 아직 미검증이다.
- HTTPS API 활성화 완료: `https://notebook-a.example.invalid`. A 자체 HTTPS 시험에서 인증서 검증·무인증 401·인증된 health/cameras/capabilities/stream/recordings 200 확인. Serve는 tailnet 내부 전용이다.
- B: FastAPI·SQLite·역할별 인증·신고/대기 작업 저장·A 상태 동기화·승인된 위치 반경 후보·녹화 추출본 검증/보존/다운로드·감사 기록을 구현했다. 실제 HTTPS 인증/상태 조회와 72개 소프트웨어 테스트 완료. [B 검증 기록](B-검증기록.md) 참고.
- B 공개 위치 API: 부산 공식 자료의 21,009개 장비 기록(16구군)을 정제해 별도 위치 카탈로그로 제공한다. 공개 위치는 영상 분석권한이 아니며 A 카메라에 복사하지 않는다.
- B의 AI worker, 실시간 영상 디코딩, 첨부파일, WebSocket, Next.js 관리자와 신고 앱은 아직 구현하지 않았다. 대기 작업을 분석 성공으로 해석하지 않는다. 실제 A 영상 보존은 승인 미등록으로 수행하지 않았다.

## 다음 B Codex가 할 일

1. B GPU는 RTX 3060 Laptop / 6144MiB / 드라이버 610.62 확인. Python 3.11.9 사용. PyTorch CUDA 추론은 아직 미검증이다.
2. B의 `notebook-b/central-server/start.ps1`로 로컬 서버를 실행할 수 있다. 기본 포트 8000, 실제 비밀 설정과 DB는 Git 제외.
3. B Tailscale 설치·로그인, A 비밀 파일 수신, HTTPS 인증/상태 조회는 완료했다. A cam-01~03의 실제 위치·시연 구역·촬영 대상 분석 승인을 사용자에게 확인받아 등록한 뒤 실제 영상 수신/보존을 검증한다. 현재 세 채널은 위치 null·승인 false다.
4. B FFmpeg/ffprobe 설치와 합성 MP4 검증은 완료했다. PyTorch CUDA·YOLO/MediaPipe와 신고 반경→후보 저FPS 탐색→집중 분석 worker를 구현·검증한다. 반경 후보 생성만 현재 구현되어 있다.
5. 첨부 업로드·증거 보존·WebSocket과 Next.js 관리자의 모의 신고를 통합한다. Expo 앱은 마지막이다.

## 미검증/운영 제한

USB 실제 탈착·포트 이동·컴퓨터 실제 재부팅·장시간 부하·실제 디스크 장애·외부망 지연·B AI 성능은 후속 실측 대상이다. 소프트웨어 프로세스 장애 복구와 실제 하드웨어 탈착 시험은 다르다.
저장 기간은 기본 7일, 공간 하한 10GiB이다. 장시간 운영 시 로그와 추출 보존본은 운영자가 관리한다. 보존 기간 만료 원본은 MediaMTX가 정리한다.
A 웹캠 카메라 좌표·분석 승인은 미등록이다. 실제 위치를 임의로 만들어 넣지 않는다. 공개 카탈로그의 2025-12-29 자료명 기준일과 2026-10-22 다운로드일은 구분한다.

## Git 협업

저장소: https://github.com/junminha/cctv (비공개).
`main`을 최신으로 받은 뒤 A/B별 브랜치에서 작업하고, API 변경은 `shared/API.md`와 함께 커밋한다.
작업 종료 시 이 문서의 현재 상태와 실제 확인한 결과를 갱신한다. 실행 파일·로컬 영상·인증 정보는 git에 올리지 않는다.
