# CCTV

시민 신고 기반 CCTV 선택적 AI 영상 분석 시스템. 설계 기준은 [cctv 최종.md](cctv%20최종.md).

## 구성

```
notebook-a/cctv-base/     # 독립 3채널 녹화·실시간·검색·재생
notebook-a/cctv-adapter/  # 인증된 영상·상태·녹화구간 API
notebook-b/central-server/ # B API·DB·AI (후속 개발)
notebook-b/admin-web/      # 관리자 (후속 개발)
smartphone/reporter-app/  # Expo 신고 앱 (마지막)
shared/                  # API·운영·검증·인수인계
```

## A 실행 (Windows)

Python 3.11 이상과 카메라가 필요하다. 현재 A에서는 Python 3.14로 검증한다. 외부 Python 패키지는 필요 없다.

```powershell
python notebook-a/cctv-base/setup.py
python notebook-a/cctv-base/register.py
powershell -ExecutionPolicy Bypass -File notebook-a/cctv-base/start.ps1
```

화면: http://127.0.0.1:8765 . 중지: `notebook-a/cctv-base/stop.ps1`.
장치 등록과 영상은 해당 컴퓨터에만 보관한다. 같은 USB 포트를 유지한다.

## 다른 컴퓨터의 Codex

```powershell
git clone https://github.com/junminha/cctv.git
cd cctv
git switch -c work/b-server
```

Codex에게 다음과 같이 전달한다:

> AGENTS.md, cctv 최종.md, shared/STATUS.md, shared/API.md를 읽고 B 노트북 부분을 개발해. A의 독립 녹화와 API 계약을 유지하고 모든 AI는 B에서 실행해. 앱은 마지막에 만들어. 이 컴퓨터 GPU를 먼저 확인해.

비공개 저장소이므로 junminha 계정 또는 초대한 GitHub 협업 계정으로 인증해야 한다. [현재 상태](shared/STATUS.md), [A 운영](shared/A-운영.md), [API](shared/API.md)를 참고한다.
