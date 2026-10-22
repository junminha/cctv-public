from contextlib import asynccontextmanager
import hmac
from typing import Annotated

import httpx
from fastapi import Depends, FastAPI, HTTPException, Path, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from adapter import Adapter, AdapterError
from clips import Clips
from models import CameraId, DEMO_CAMERA_IDS, LocationInput, PreserveInput, ReportInput, UtcDatetime, utc
from public_catalog import list_cameras as public_cameras
from store import Store


def create_app(settings, adapter_http=None):
    @asynccontextmanager
    async def lifespan(app):
        app.state.store = Store(settings.database_path)
        with httpx.Client(timeout=10, follow_redirects=False, trust_env=False) as http:
            app.state.adapter = Adapter(settings, adapter_http if adapter_http is not None else http)
            folder = getattr(settings, 'clips_dir', settings.database_path.parent / 'clips')
            app.state.clips = Clips(folder, app.state.store, app.state.adapter)
            yield

    app = FastAPI(title='CCTV B Central Server', version='0.1.0', lifespan=lifespan)
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

    @app.exception_handler(AdapterError)
    async def adapter_error(request, exc):
        return JSONResponse(status_code=exc.status, content={'detail': exc.message})

    @app.get('/health')
    def health():
        return {'status': 'ok'}

    @app.get('/api/v1/admin/status', dependencies=[Depends(admin)])
    def status():
        return {'ai_worker_available': False,
                'adapter_configured': bool(settings.adapter_url and settings.adapter_token)}

    @app.post('/api/v1/reports', status_code=201)
    def report(payload: ReportInput, identity: Annotated[dict, Depends(role('reporter'))]):
        return intake(payload, identity, 'reporter')

    @app.post('/api/v1/demo/reports', status_code=201)
    def demo(payload: ReportInput, identity: Annotated[dict, Depends(admin)]):
        return intake(payload, identity, 'demo')

    def intake(payload, identity, source):
        result = app.state.store.create_report(payload, identity['subject'], source)
        return {key: result[key] for key in ('report_id', 'source', 'created_at', 'job')}

    @app.get('/api/v1/reports/{report_id}/status')
    def report_status(report_id: str, identity: Annotated[dict, Depends(role('reporter', 'admin'))]):
        result = find_report(report_id)
        if identity['role'] != 'admin' and (result['source'] != 'reporter' or result['owner'] != identity['subject']):
            raise HTTPException(404, 'Report not found')
        return {'report_id': result['report_id'], 'job': result['job']}

    @app.get('/api/v1/admin/reports', dependencies=[Depends(admin)])
    def list_reports(limit: Annotated[int, Query(ge=1, le=100)] = 50,
                     offset: Annotated[int, Query(ge=0)] = 0):
        return {'reports': app.state.store.reports(limit, offset)}

    @app.get('/api/v1/admin/reports/{report_id}', dependencies=[Depends(admin)])
    def report_detail(report_id: str):
        return find_report(report_id)

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
