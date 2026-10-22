# A Adapter API v1

A의 base는 로컬 전용이며 B는 이 Adapter만 사용한다. 중앙 서버는 장치 경로/인덱스를 저장하지 않는다.

## 연결과 인증

- 개발 로컬: `http://127.0.0.1:8766`.
- 외부 주소: `https://notebook-a.example.invalid`. Tailscale Serve 활성화 및 A 자체 HTTPS 시험 완료. 같은 tailnet의 B에서 실제 접속하는 시험은 남아 있다.
- 인증 RTSP 주소: `rtsp://192.0.2.10:8555/{camera_id}`. A 내부 자체 접속 검증 완료, B 수신은 미검증.
- 모든 요청: `Authorization: Bearer <A의 secrets.json.token>`.
- RTSP는 별도 인증 계정 `rtsp_user`/`rtsp_password`를 B 비밀 설정에 전달한다. URL 또는 GitHub에 자격증명을 넣지 않는다.
- A의 base RTSP/API/HLS/playback은 loopback에만 바인딩한다. 원격 RTSP는 별도 relay가 Tailscale IPv4:8555에만 바인딩한다. relay 중지는 A 녹화에 영향을 주지 않는다.
- 외부망 연결/인증과 B의 실제 수신은 양쪽 Tailscale 로그인 후 검증해야 한다. 현재 상태는 `STATUS.md` 참고.

## 엔드포인트

| 메서드 | 경로 | 응답/입력 |
|---|---|---|
| GET | `/agent/v1/health` | base 상태·디스크·카메라 상태 |
| GET | `/agent/v1/cameras` | `{cameras:[{id,name,online,recording,...}]}` |
| GET | `/agent/v1/capabilities` | 버전·RTSP/TCP·녹화/추출 지원·AI false |
| GET | `/agent/v1/cameras/{id}/stream` | `{camera_id,url,transport,authentication}`; relay 미설정이면 503 |
| GET | `/agent/v1/recordings?camera_id=cam-01&start=...&end=...` | `{camera_id,ranges:[{start,duration}]}` |
| POST | `/agent/v1/recordings/export` | `{camera_id,start,duration}`; 최대 3600초, 동시 1건. 성공 201 |
| GET | `/agent/v1/exports/{export_id}` | 인증된 추출 MP4 다운로드 |

카메라 ID는 `cam-01`, `cam-02`, `cam-03`. 위치는 아직 설정하지 않았다. B에서 실제/데모 위치를 명시적으로 등록해야 한다.
시간은 timezone 있는 RFC3339 입력, 출력 UTC ISO8601이다. duration은 초 단위 실수.
조회는 확정된 세그먼트만 포함할 수 있어 최대 약 60초 지연된다. 인접 세그먼트는 연속 구간으로 합쳐질 수 있다.
요청 구간 전체가 존재함을 보장하지 않으므로 B는 ranges와 실제 추출 파일 재생 길이를 확인한다. `requested_duration`은 요청값이며 실측 재생 길이가 아니다.

추출 응답: `export_id,camera_id,start,requested_duration,sha256,bytes,download_path,source,created`.
원본 파일은 수정하지 않는다. 추출은 remux된 파생 MP4이며 원본과 바이트 동일한 파일이라고 주장하지 않는다. 감사 로그는 A의 로컬 `logs/audit.jsonl`에 저장한다.
추출 파일은 수동 보존하며 자동 삭제하지 않는다. 불필요한 추출은 운영자가 검토 후 정리한다.

오류: 400 잘못된 카메라/시간/길이, 401 인증 실패, 404 자료 없음, 429 추출 중, 503 base/relay 미연결.

## B 요청 예시

```python
import os, requests
base = os.environ['CCTV_ADAPTER_URL']
headers = {'Authorization': 'Bearer ' + os.environ['CCTV_ADAPTER_TOKEN']}
r = requests.get(base + '/agent/v1/cameras', headers=headers, timeout=10)
r.raise_for_status()
```

인증 정보는 환경변수로 전달한다. B에서 직접 RTSP를 읽을 때 TCP 전송을 강제한다.
