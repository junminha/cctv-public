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

## B 중앙 API v1 — 1차 구현 계약

B 기본 주소는 `http://127.0.0.1:8000`. 외부 노출은 별도 HTTPS 구성 후 진행한다.
`GET /health` 외 모든 업무 API는 B Bearer 토큰이 필요하다. B 토큰과 A 토큰은 별개다.
토큰별 `role`(admin/reporter/agent), `subject`를 서버의 비밀 설정으로 관리한다.
신고자마다 다른 subject를 발급한다. 단일 공용 신고자 토큰은 개인별 소유권을 제공하지 않는다.

| 메서드 | 경로 | 권한 / 동작 |
|---|---|---|
| GET | `/health` | 공개 최소 생존 확인 |
| GET | `/api/v1/admin/status` | 관리자, AI 미구현·Adapter 설정 여부 |
| POST | `/api/v1/reports` | 신고자, 신고·대기 작업을 하나의 DB 트랜잭션으로 생성 |
| POST | `/api/v1/demo/reports` | 관리자, 같은 접수 파이프라인; source=demo |
| GET | `/api/v1/reports/{id}/status` | 신고 소유자 또는 관리자, 작업 대기 상태 |
| GET | `/api/v1/admin/reports` | 관리자, 최근 신고 목록 (limit≤100, offset) |
| GET | `/api/v1/admin/reports/{id}` | 관리자, 신고 본문·위치·작업 |
| POST | `/api/v1/admin/agent/sync` | 관리자, A 카메라 메타데이터 읽기·저장 |
| GET | `/api/v1/admin/cameras` | 관리자, 마지막 관측·신선도·등록 위치 |
| PUT | `/api/v1/admin/cameras/{id}/location` | 관리자, 위치·접근 승인 등록 |
| GET | `/api/v1/admin/reports/{id}/candidates` | 관리자, 승인·온라인·60초 이내·동일 위치종류·반경 내 거리 후보 |
| GET | `/api/v1/admin/recordings` | 관리자, A 녹화구간 조회; camera_id/start/end 필수 |
| GET | `/api/v1/agent/jobs` | agent, 대기 작업 메타데이터 조회 (worker/실행 기능 아님) |

신고 입력: `description`(1~4000자), `latitude`(-90~90), `longitude`(-180~180),
`location_kind`(real/demo, 기본 real), `details`(최대 1000자),
`occurred_at`(timezone 있는 RFC3339, 선택), `radius_m`(1~5000m, 기본 500m).
접수·작업 출력: `report_id`, `source`, `created_at`, `job`.
작업은 `id,report_id,state=queued,stage=awaiting_worker,progress=0`이다.
분석 결과나 긴급성을 판정하지 않는다. 입력 위반 422, 인증 401, 권한 403,
없는 신고/카메라 404, A 설정 없음/통신 실패 503, 잘못된 A 응답 502.
다른 신고자의 상태 조회도 404로 처리한다. B는 A 비밀 토큰·장치 경로를 반환하지 않는다.
위치 입력: `latitude,longitude,kind`(real/demo), `approved`(bool).
카메라 ID는 A에서 받은 ID만 사용하며 미등록 카메라 좌표를 임의 생성하지 않는다.
녹화 조회는 timezone 있는 `start < end`이며 A가 제공한 구간을 반환한다.
이 단계는 파일 추출/보존이나 실제 영상 수신을 수행하지 않는다.

## B 영상 연동·보존 확장

이 확장이 적용되면 위 1차 구현의 파일 추출/보존 제한을 대체한다. AI worker는 계속 미구현이다.

| 메서드 | 경로 | 권한 / 동작 |
|---|---|---|
| GET | `/api/v1/admin/agent/health` | 관리자, A 상태·카메라를 검증된 필드만 조회 |
| POST | `/api/v1/admin/reports/{id}/preserve` | 관리자, 지정 녹화구간 추출·해시/바이트/영상 확인 후 B 보관 |
| GET | `/api/v1/admin/reports/{id}/clips` | 관리자, 사건별 보존 목록 |
| GET | `/api/v1/admin/clips/{clip_id}/download` | 관리자, B 보관 파일 무결성 재확인 후 다운로드·감사 기록 |

보존 입력: `camera_id,start`(timezone 필수), `duration`(0초 초과~3600초).
미등록 카메라 404, 미승인/신고 위치종류 불일치 403, 녹화구간 공백 409,
동시 보존 중 429, A 장애/도구 미설정/저장공간 부족 503,
잘못된 A 메타데이터·크기·해시·영상 파일 502.
다운로드 파일 무결성 변조는 409. 요청당 최대 파일 2GiB, 실제 다운로드도 같은 한도.

응답은 `clip_id,report_id,camera_id,start,requested_duration,measured_duration,sha256,bytes,
upstream_export_id,created_at,source,recording_ranges_cover_request,duration_matches_request,download_path`.
`source`는 A 원본 녹화에서 remux한 파생본임을 표시한다. 원본 바이트 동일성을 주장하지 않는다.
`measured_duration`은 ffprobe의 컨테이너 재생 길이이며 전체 디코딩/연속성 증명이 아니다.
`duration_matches_request`는 길이 차이 1초 이내 여부, 녹화구간 커버 여부는 별도 검사한다.
둘 다 true여도 정확한 사건 시각·영상 내용은 사람이 확인해야 한다.
로컬 저장 경로·A 비밀정보는 반환하지 않는다. 실패한 다운로드는 보존 목록에 넣지 않는다.

A 비밀 파일은 B `notebook-b/central-server/runtime/a-secrets.json`에 둔다.
입력 키는 A에서 받은 `token,rtsp_user,rtsp_password`, `adapter_url`은 선택이다.
파일에 URL이 없으면 공유 문서의 A HTTPS 주소를 사용한다. `CCTV_ADAPTER_URL/TOKEN`은 파일보다 우선한다.
JSON의 비밀 값은 진단 출력·DB·로그·Git에 넣지 않는다.

## 공개 CCTV 위치 카탈로그

`GET /api/v1/admin/public-cameras` (관리자만): 부산광역시가 공개한 실제 위치 메타데이터.
선택 필터 `west,south,east,north`는 모두 함께 지정하며 경도·위도 순서의 경계 포함 bbox다.
`limit` 1~1000(기본 100), `offset` 0 이상. 응답은 `cameras,total,source`.
`total`은 범위 필터 후·페이지 적용 전 장비 기록 수다.
원문 출처·자료명 일자·다운로드 시각·품질 제외 집계는 `source`에 유지한다.
모든 항목은 `metadata_only=true,analysis_available=false`이며 A의 카메라 DB와 별개다.
카탈로그 조회로 A의 좌표·승인을 변경하거나 실제 영상 후보에 추가하지 않는다.

### 현재 시연 소스 제한

사용자 결정: 실제 공공 CCTV는 지도·목록에만 표시하고 AI 학습·분석·시연 영상 입력에서 제외한다.
시연 영상 입력은 A의 웹캠 `cam-01`(내장), `cam-02`, `cam-03`(USB)만 허용한다.
다른 카메라는 Adapter가 제공하거나 DB에 승인값이 있더라도 AI 후보·클립 보존 대상이 될 수 없다.
추가 카메라의 `approved=true` 등록 요청은403으로 거부한다.
연결된 카메라 목록의 `demo_source`는 이 세 웹캠 여부만 나타내며 촬영 대상의 동의·분석 승인을 대신하지 않는다.
현재 서버에는 AI 학습 기능이 없으며, 향후 AI worker도 같은 입력 제한을 적용한다.

## B 분석·첨부·관제 확장 (v0.2)

이 확장이 적용되면 위 1차 구현의 "AI worker 미구현" 설명을 대체한다. 실제 A 웹캠 분석은 위치·촬영 대상 동의 승인 등록 뒤에만 수행한다.

| 메서드 | 경로 | 권한 / 동작 |
|---|---|---|
| POST | `/api/v1/reports/{id}/attachments` | 신고 소유자·관리자, multipart `file` + `consent=true`. 201 첨부 메타데이터 |
| GET | `/api/v1/reports/{id}/attachments/{attachment_id}` | 신고 소유자·관리자, 파일 수신·감사 기록 |
| POST | `/api/v1/admin/reports/{id}/analyze` | 관리자, `{mode,source,duration,sample_fps,focus_fps,top_k}` 202 작업 접수 |
| POST | `/api/v1/admin/reports/{id}/confirm` | 관리자, `{note}` 담당자 확인 기록 |
| POST | `/api/v1/admin/reports/{id}/close` | 관리자, `{note}` 사건 종결 기록 |
| GET | `/api/v1/admin/reports/{id}/artifacts/{kind}/{owner}/{file}` | 관리자, 근거 이미지. kind=scan/focus/all/phone, file=evidence-01~03.jpg |
| GET | `/api/v1/admin/cameras/{id}/snapshot` | 관리자, 승인된 세 웹캠만 최근 JPEG (2초 캐시) |
| GET | `/api/v1/admin/metrics` | 관리자, 접수/작업/결과 통계, 지연(mean/median/p95), 선택·전체 비교 |
| POST | `/api/v1/admin/ws-ticket` | 관리자, 30초 단회 ticket |
| WS | `/ws/v1/admin` | 첫 메시지 `{ticket}`. 허용 Origin만. 2초마다 `{type:'snapshot',reports,cameras,time}` |

- 분석 입력: `mode` selective(기본)/all/benchmark, `source` live(기본)/recording, `duration` 2~60초(기본10),
  `sample_fps` 0~5(기본1), `focus_fps` 0~10(기본3), `top_k` 1~3(기본1). 실행 중 재요청 409, worker 꺼짐 503.
- `CCTV_WORKER_ENABLED=true`, `CCTV_AUTO_ANALYZE=true`이면 신고 접수 시 기본 분석을 자동 대기열에 넣는다.
  발생 시각이 120초 넘게 지난 신고는 recording, 그 외 live를 사용한다.
- 작업 `job`: `state`(queued/running/completed/failed), `stage`, `progress`, `error`, `params`(관리자만).
  단계: RECEIVED → CLASSIFIED → CANDIDATES_FOUND → SCANNING → FOCUSED_ANALYSIS → SUMMARIZING → 결과.
  결과 stage: REVIEW_REQUIRED, VIDEO_NOT_VISIBLE, NO_CAMERA_IN_RANGE, CAMERA_UNAVAILABLE, RECORDING_UNAVAILABLE,
  MANUAL_REVIEW_REQUIRED(failed). 신고자 상태 조회에는 `params`를 넣지 않는다.
- 관리자 신고 상세는 기존 필드 + `attachments[]`, `analysis`, `review`, `events[]`.
  `analysis`: `classification`, `candidates`, `cameras[]`(status, window, scan/focus/all, event_score, rank_score),
  `selected_camera_ids`, `summary`, `phone[]`, `benchmark`, `outcome`, `latency_seconds`, `warnings`.
- 후보 순위: `(0.20·근접 + 0.15·시간일치 + 0.45·영상 관련성)/0.80` (첨부 맥락 항목은 재정규화로 제외).
  관련성 0인 카메라는 집중 분석하지 않는다. 모든 관찰은 `verified=false`, 요약은 `requires_human_review=true`.
- 자동 분석 클립은 `runtime/analysis` 캐시이며 사건 보존 목록(`clips`)과 별개다. 보존은 기존 preserve API로 한다.
- 첨부: 파일 서명으로 형식 판정(JPEG/PNG/WebP, WAV/MP3/M4A/WebM 음성, MP4/MOV/WebM 영상).
  이미지 15MiB, 음성 25MiB, 영상 100MiB, 신고당 10개. 다른 신고자의 첨부는 404.
- 카메라 위치 입력에 선택 `zone`(최대 100자) 추가.
- OpenAI: B `.env`의 `OPENAI_API_KEY`. 기본 모델 `gpt-6-luna`, 전사 `gpt-transcribe`(2026-10-22 공식 문서 기준
  `gpt-4.1-mini`·`gpt-4o-mini-transcribe`는 지원 종료 예정). 키 없음·실패 시 `source=local_*`과 경고로 처리한다.
- Live 분석은 A stream API의 RTSP URL에 B 비밀 설정의 RTSP 계정을 넣어 FFmpeg가 TCP로 읽는다. 자격증명은 응답·DB에 저장하지 않는다.

## B 신고 내보내기 (v0.3)

| 메서드 | 경로 | 권한 / 동작 |
|---|---|---|
| GET | `/api/v1/admin/exports/reports.csv?start=&end=` | 관리자, 접수 신고 전체 CSV. `start`/`end`(UTC ISO, 선택)는 접수 시각 [start, end) 필터. 감사 `reports_csv_exported` |
| GET | `/api/v1/admin/reports/{id}/package.zip?media=true` | 관리자, 신고 1건 증거 묶음 ZIP. 감사 `report_package_exported` |

- CSV: UTF-8 BOM, 시각은 KST 표기. 시민 입력이 `= + - @`, 탭, CR로 시작하면 앞에 `'`를 붙여 수식 실행을 막는다.
  열: 신고 ID, 접수/발생 시각, 출처, 사건 유형, 내용, 좌표·위치 구분·반경, 분석 상태·단계·결과, 선정 카메라, 요약, 권장 조치, 첨부 수, 확인/종결 시각·담당자·메모.
- ZIP: `report.json`(관리자 신고 상세), `clips.json`, `audit.json`(해당 신고 감사 기록, 이번 내보내기 포함), `manifest.json`.
  `media=true`(기본)이면 `attachments/`, `clips/`(보존 영상), `analysis/`(근거 프레임·분석 클립 캐시)를 함께 넣는다.
  `manifest.files[]`는 각 파일의 `bytes`, `sha256`을 담고, 첨부·보존 영상은 저장 시 기록한 해시와 비교한 `matches_recorded_sha256`을 추가한다.
  파일이 없으면 실패 대신 `manifest.missing[]`에 적는다. 임시 ZIP은 `runtime/exports`에 만들고 응답 후 지운다.
