import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import hmac
from pathlib import Path as FilePath
import secrets
import statistics
import threading
import time
from typing import Annotated

import httpx
from fastapi import (Depends, FastAPI, File, Form, HTTPException, Path, Query, UploadFile, WebSocket,
                     WebSocketDisconnect)
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from adapter import Adapter, AdapterError
from attachments import Attachments
from clips import Clips
from intelligence import Intelligence
from media import snapshot as capture_snapshot
from models import (AnalyzeInput, CameraId, DEMO_CAMERA_IDS, LocationInput, PreserveInput, ReportInput,
                    ReviewInput, UtcDatetime, utc)
from public_catalog import list_cameras as public_cameras
from store import Store
from vision import VisionEngine
from worker import Pipeline, Worker

ARTIFACT = r'^evidence-0[1-3]\.jpg$'
TICKET_SECONDS = 30


def create_app(settings, adapter_http=None, vision=None, intelligence=None):
    runtime = settings.database_path.parent

    @asynccontextmanager
    async def lifespan(app):
        app.state.store = Store(settings.database_path)
        with httpx.Client(timeout=10, follow_redirects=False, trust_env=False) as http:
            app.state.adapter = Adapter(settings, adapter_http if adapter_http is not None else http)
            folder = getattr(settings, 'clips_dir', runtime / 'clips')
            app.state.clips = Clips(folder, app.state.store, app.state.adapter)
            app.state.attachments = Attachments(getattr(settings, 'attachments_dir', runtime / 'attachments'),
                                                app.state.store)
            app.state.vision = vision if vision is not None else VisionEngine(settings)
            app.state.intelligence = intelligence if intelligence is not None else Intelligence(settings)
            app.state.analysis_dir = FilePath(getattr(settings, 'analysis_dir', runtime / 'analysis'))
            app.state.worker = None
            if getattr(settings, 'worker_enabled', False):
                pipeline = Pipeline(settings, app.state.store, app.state.adapter, app.state.vision,
                                    app.state.intelligence)
                app.state.worker = Worker(pipeline, app.state.store)
                app.state.worker.start()
            try:
                yield
            finally:
                if app.state.worker is not None:
                    app.state.worker.stop()

    app = FastAPI(title='CCTV B Central Server', version='0.2.0', lifespan=lifespan)
    tickets, ticket_lock = {}, threading.Lock()
    snapshots = {}
    bearer = HTTPBearer(auto_error=False)

    def principal(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]):
        supplied = credentials.credentials if credentials is not None else ''
        for token, identity in settings.tokens.items():
            if hmac.compare_digest(supplied.encode('utf-8'), token.encode('utf-8')):
                return identity
        raise HTTPException(401, 'Authentication required', headers={'WWW-Authenticate': 'Bearer'})

    def role(*allowed):
        def check(identity: Annotated[dict, Depends(principal)]):
            if identity['role'] not in allowed:
                raise HTTPException(403, 'Role is not permitted')
            return identity
        return check

    admin = role('admin')

    def find_report(report_id):
        report = app.state.store.report(report_id)
        if report is None:
            raise HTTPException(404, 'Report not found')
        return report

    def owned_report(report_id, identity):
        report = find_report(report_id)
        # Other reporters' reports are indistinguishable from missing ones.
        if identity['role'] != 'admin' and (report['source'] != 'reporter' or report['owner'] != identity['subject']):
            raise HTTPException(404, 'Report not found')
        return report

    def worker_running():
        worker = app.state.worker
        return worker is not None and worker.thread.is_alive()

    def default_analysis(payload):
        if not (getattr(settings, 'worker_enabled', False) and getattr(settings, 'auto_analyze', False)):
            return None
        past = payload.occurred_at is not None and (
            datetime.now(timezone.utc) - payload.occurred_at > timedelta(seconds=120))
        return AnalyzeInput(source='recording' if past else 'live').model_dump()

    @app.exception_handler(AdapterError)
    async def adapter_error(request, exc):
        return JSONResponse(status_code=exc.status, content={'detail': exc.message})

    @app.get('/health')
    def health():
        return {'status': 'ok'}

    @app.get('/api/v1/admin/status', dependencies=[Depends(admin)])
    def status():
        vision_status = app.state.vision.status()
        return {'ai_worker_available': worker_running() and vision_status['models_present'],
                'worker_enabled': bool(getattr(settings, 'worker_enabled', False)),
                'worker_running': worker_running(),
                'current_report_id': app.state.worker.current if app.state.worker else None,
                'auto_analyze': bool(getattr(settings, 'auto_analyze', False)),
                'vision': vision_status, 'openai': app.state.intelligence.status(),
                'adapter_configured': bool(settings.adapter_url and settings.adapter_token),
                'demo_camera_ids': list(DEMO_CAMERA_IDS)}

    @app.post('/api/v1/reports', status_code=201)
    def report(payload: ReportInput, identity: Annotated[dict, Depends(role('reporter'))]):
        return intake(payload, identity, 'reporter')

    @app.post('/api/v1/demo/reports', status_code=201)
    def demo(payload: ReportInput, identity: Annotated[dict, Depends(admin)]):
        return intake(payload, identity, 'demo')

    def intake(payload, identity, source):
        result = app.state.store.create_report(payload, identity['subject'], source, default_analysis(payload))
        return {key: result[key] for key in ('report_id', 'source', 'created_at', 'job')}

    @app.get('/api/v1/reports/{report_id}/status')
    def report_status(report_id: str, identity: Annotated[dict, Depends(role('reporter', 'admin'))]):
        result = owned_report(report_id, identity)
        job = {key: result['job'][key] for key in ('id', 'report_id', 'state', 'stage', 'progress', 'error')}
        return {'report_id': result['report_id'], 'job': job}

    @app.post('/api/v1/reports/{report_id}/attachments', status_code=201)
    def upload(report_id: str, identity: Annotated[dict, Depends(role('reporter', 'admin'))],
               file: Annotated[UploadFile, File()], consent: Annotated[bool, Form()]):
        return app.state.attachments.save(owned_report(report_id, identity), file, consent, identity)

    @app.get('/api/v1/reports/{report_id}/attachments/{attachment_id}')
    def attachment(report_id: str, attachment_id: Annotated[str, Path(pattern=r'^[0-9a-f]{32}$')],
                   identity: Annotated[dict, Depends(role('reporter', 'admin'))]):
        owned_report(report_id, identity)
        path, metadata = app.state.attachments.path(report_id, attachment_id)
        app.state.store.audit('attachment_downloaded', identity['subject'], report_id, attachment_id)
        return FileResponse(path, media_type=metadata['content_type'], filename=path.name)

    @app.get('/api/v1/admin/reports', dependencies=[Depends(admin)])
    def list_reports(limit: Annotated[int, Query(ge=1, le=100)] = 50,
                     offset: Annotated[int, Query(ge=0)] = 0):
        return {'reports': app.state.store.reports(limit, offset)}

    @app.get('/api/v1/admin/reports/{report_id}', dependencies=[Depends(admin)])
    def report_detail(report_id: str):
        find_report(report_id)
        return app.state.store.detail(report_id)

    @app.post('/api/v1/admin/reports/{report_id}/analyze', status_code=202, dependencies=[Depends(admin)])
    def analyze(report_id: str, payload: AnalyzeInput):
        find_report(report_id)
        if not worker_running():
            raise HTTPException(503, 'AI worker is not running; set CCTV_WORKER_ENABLED=true')
        if not app.state.store.request_analysis(report_id, payload.model_dump()):
            raise HTTPException(409, 'Analysis is already running for this report')
        return {'report_id': report_id, 'job': app.state.store.report(report_id)['job']}

    @app.post('/api/v1/admin/reports/{report_id}/confirm')
    def confirm(report_id: str, payload: ReviewInput, identity: Annotated[dict, Depends(admin)]):
        find_report(report_id)
        return app.state.store.review(report_id, 'confirm', identity['subject'], payload.note)

    @app.post('/api/v1/admin/reports/{report_id}/close')
    def close(report_id: str, payload: ReviewInput, identity: Annotated[dict, Depends(admin)]):
        find_report(report_id)
        return app.state.store.review(report_id, 'close', identity['subject'], payload.note)

    @app.get('/api/v1/admin/reports/{report_id}/artifacts/{kind}/{owner}/{filename}',
             dependencies=[Depends(admin)])
    def artifact(report_id: Annotated[str, Path(pattern=r'^[0-9a-f]{32}$')],
                 kind: Annotated[str, Path(pattern=r'^(scan|focus|all|phone)$')],
                 owner: Annotated[str, Path(pattern=r'^[a-z0-9][a-z0-9-]{0,63}$')],
                 filename: Annotated[str, Path(pattern=ARTIFACT)]):
        path = app.state.analysis_dir / report_id / kind / owner / filename
        if not path.is_file():
            raise HTTPException(404, 'Artifact not found')
        return FileResponse(path, media_type='image/jpeg', headers={'Cache-Control': 'private, max-age=60'})

    @app.get('/api/v1/admin/metrics', dependencies=[Depends(admin)])
    def metrics():
        data = app.state.store.metrics()
        analyses = data.pop('analyses')
        latencies = sorted(row['latency_seconds'] for row in analyses if row.get('latency_seconds') is not None)
        outcomes = {}
        for row in analyses:
            outcomes[row.get('outcome', 'UNKNOWN')] = outcomes.get(row.get('outcome', 'UNKNOWN'), 0) + 1
        latency = None
        if latencies:
            latency = {'count': len(latencies), 'mean': round(statistics.fmean(latencies), 3),
                       'median': round(statistics.median(latencies), 3),
                       'p95': round(latencies[min(len(latencies) - 1, int(0.95 * len(latencies)))], 3)}
        benchmarks = [{'report_id': row.get('report_id'), 'finished_at': row.get('finished_at'),
                       **row['benchmark']} for row in analyses if row.get('benchmark')][:20]
        return {**data, 'outcomes': outcomes, 'latency_seconds': latency, 'benchmarks': benchmarks,
                'note': '지연은 분석 요청(자동 분석은 신고 접수) 시각부터 결과 저장까지입니다.'}

    @app.post('/api/v1/admin/ws-ticket', dependencies=[Depends(admin)])
    def ws_ticket():
        ticket = secrets.token_urlsafe(32)
        now = time.monotonic()
        with ticket_lock:
            for key in [key for key, expiry in tickets.items() if expiry < now]:
                del tickets[key]
            tickets[ticket] = now + TICKET_SECONDS
        return {'ticket': ticket, 'expires_in': TICKET_SECONDS}

    def overview():
        store = app.state.store
        reports = []
        for row in store.reports(30, 0):
            detail = store.detail(row['report_id'])
            analysis = detail['analysis'] or {}
            reports.append({key: detail.get(key) for key in (
                'report_id', 'source', 'created_at', 'description', 'latitude', 'longitude', 'location_kind',
                'radius_m', 'job', 'review')} | {'outcome': analysis.get('outcome'),
                                                'selected_camera_ids': analysis.get('selected_camera_ids', []),
                                                'incident_type': analysis.get('classification', {}).get('incident_type')})
        return {'type': 'snapshot', 'reports': reports, 'cameras': store.cameras(), 'time': utc(),
                'worker_running': worker_running()}

    @app.websocket('/ws/v1/admin')
    async def admin_socket(websocket: WebSocket):
        origin = websocket.headers.get('origin')
        allowed = getattr(settings, 'admin_origins', ('http://localhost:3000', 'http://127.0.0.1:3000'))
        if origin is not None and origin.rstrip('/') not in allowed:
            await websocket.close(code=1008)
            return
        await websocket.accept()
        try:
            first = await asyncio.wait_for(websocket.receive_json(), timeout=5)
            ticket = first.get('ticket') if isinstance(first, dict) else None
            with ticket_lock:
                expiry = tickets.pop(ticket, None) if isinstance(ticket, str) else None
            if expiry is None or expiry < time.monotonic():
                await websocket.close(code=1008)
                return
            while True:
                await websocket.send_json(await run_in_threadpool(overview))
                await asyncio.sleep(2)
        except (WebSocketDisconnect, asyncio.TimeoutError, ValueError):
            return

    @app.get('/api/v1/agent/jobs', dependencies=[Depends(role('agent'))])
    def jobs(limit: Annotated[int, Query(ge=1, le=100)] = 50):
        return {'jobs': app.state.store.jobs(limit)}

    @app.post('/api/v1/admin/agent/sync', dependencies=[Depends(admin)])
    def sync():
        try:
            cameras = app.state.adapter.cameras()
        except AdapterError:
            app.state.store.invalidate_cameras()
            raise
        app.state.store.sync(cameras)
        return {'cameras': app.state.store.cameras()}

    @app.get('/api/v1/admin/cameras', dependencies=[Depends(admin)])
    def cameras():
        return {'cameras': app.state.store.cameras()}

    @app.get('/api/v1/admin/public-cameras', dependencies=[Depends(admin)])
    def public_locations(west: float | None = None, south: float | None = None,
                         east: float | None = None, north: float | None = None,
                         limit: Annotated[int, Query(ge=1, le=1000)] = 100,
                         offset: Annotated[int, Query(ge=0)] = 0):
        values = (west, south, east, north)
        if any(value is not None for value in values) and any(value is None for value in values):
            raise HTTPException(422, 'Specify all four bounds together')
        try:
            return public_cameras(None if west is None else values, limit, offset)
        except ValueError:
            raise HTTPException(422, 'Invalid geographic bounds') from None

    @app.get('/api/v1/admin/agent/health', dependencies=[Depends(admin)])
    def agent_health():
        return app.state.adapter.health()

    @app.get('/api/v1/admin/cameras/{camera_id}/snapshot', dependencies=[Depends(admin)])
    def camera_snapshot(camera_id: CameraId):
        camera = next((row for row in app.state.store.cameras() if row['id'] == camera_id), None)
        if camera is None:
            raise HTTPException(404, 'Camera not found')
        if camera_id not in DEMO_CAMERA_IDS or not camera['approved']:
            raise HTTPException(403, 'Live frames require one of the three approved demo webcams')
        cached = snapshots.get(camera_id)
        if cached is None or time.monotonic() - cached[0] > 2:
            image = capture_snapshot(app.state.adapter.stream(camera_id), getattr(settings, 'rtsp_user', ''),
                                     getattr(settings, 'rtsp_password', ''))
            cached = snapshots[camera_id] = (time.monotonic(), image)
        return Response(cached[1], media_type='image/jpeg', headers={'Cache-Control': 'no-store'})

    @app.put('/api/v1/admin/cameras/{camera_id}/location', dependencies=[Depends(admin)])
    def locate(camera_id: CameraId, location: LocationInput):
        if location.approved and camera_id not in DEMO_CAMERA_IDS:
            if camera_id not in {row['id'] for row in app.state.store.cameras()}:
                raise HTTPException(404, 'Camera not found')
            raise HTTPException(403, 'Only the three demo webcam channels may be approved')
        if not app.state.store.locate(camera_id, location):
            raise HTTPException(404, 'Camera not found')
        return {'camera_id': camera_id, **location.model_dump()}

    @app.get('/api/v1/admin/reports/{report_id}/candidates', dependencies=[Depends(admin)])
    def candidates(report_id: str):
        report = find_report(report_id)
        return {'report_id': report_id, 'selection': 'distance_candidates_only',
                'cameras': app.state.store.candidates(report)}

    @app.get('/api/v1/admin/recordings', dependencies=[Depends(admin)])
    def recordings(camera_id: CameraId, start: UtcDatetime, end: UtcDatetime):
        if start >= end:
            raise HTTPException(422, 'Start must precede end')
        if camera_id not in {camera['id'] for camera in app.state.store.cameras()}:
            raise HTTPException(404, 'Camera not found')
        return app.state.adapter.recordings(camera_id, utc(start), utc(end))

    @app.post('/api/v1/admin/reports/{report_id}/preserve', status_code=201)
    def preserve(report_id: str, payload: PreserveInput, identity: Annotated[dict, Depends(admin)]):
        return app.state.clips.preserve(find_report(report_id), payload, identity['subject'])

    @app.get('/api/v1/admin/reports/{report_id}/clips', dependencies=[Depends(admin)])
    def clips(report_id: str):
        find_report(report_id)
        return {'clips': app.state.store.clips(report_id)}

    @app.get('/api/v1/admin/clips/{clip_id}/download')
    def download(clip_id: Annotated[str, Path(pattern=r'^[0-9a-f]{32}$')],
                 identity: Annotated[dict, Depends(admin)]):
        path = app.state.clips.download(clip_id, identity['subject'])
        return FileResponse(path, media_type='video/mp4', filename=clip_id + '.mp4')

    return app
