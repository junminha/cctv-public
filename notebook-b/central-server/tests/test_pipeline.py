"""End-to-end analysis with a virtual A and REAL YOLO/MediaPipe on synthetic clips.

The virtual A serves a different synthetic clip per webcam (standing people + bus, a lying
person, an empty scene). These are model/software checks, not real CCTV footage results.
"""
import hashlib
import json
import time
from types import SimpleNamespace

from fastapi.testclient import TestClient
import httpx
import pytest

from app import create_app
from intelligence import Intelligence
import worker as worker_module
from test_server import ADMIN, OTHER, REPORTER, TOKENS, auth
from test_vision import MODELS, clips  # noqa: F401 - pytest fixture

FALL = {'description': '정문 안쪽 복도에 사람이 쓰러져 누워 있어요', 'latitude': 35.1336, 'longitude': 129.1030,
        'location_kind': 'demo', 'details': '시연 부스 1층', 'radius_m': 100}
PLACES = {'cam-01': (35.13360, 129.10300), 'cam-02': (35.13365, 129.10305), 'cam-03': (35.13355, 129.10295)}
JPEG = b'\xff\xd8\xff\xe0' + b'0' * 200


def wait(client, report_id, timeout=120):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = client.get(f'/api/v1/admin/reports/{report_id}', headers=auth(ADMIN)).json()['job']
        if job['state'] in ('completed', 'failed'):
            return client.get(f'/api/v1/admin/reports/{report_id}', headers=auth(ADMIN)).json()
        time.sleep(0.2)
    raise AssertionError('analysis did not finish')


@pytest.fixture
def system(tmp_path, clips):  # noqa: F811
    bodies = {'cam-01': clips['standing'].read_bytes(), 'cam-02': clips['lying'].read_bytes(),
              'cam-03': clips['empty'].read_bytes()}
    state = {'exports': {}, 'online': {'cam-01': True, 'cam-02': True, 'cam-03': True}}
    settings = SimpleNamespace(
        database_path=tmp_path / 'central.sqlite3', tokens=TOKENS, adapter_url='https://a.test',
        adapter_token='virtual-a-token', rtsp_user='reader', rtsp_password='secret', worker_enabled=True,
        auto_analyze=False, ai_device='auto', yolo_model=str(MODELS / 'yolo26n.pt'),
        pose_model=str(MODELS / 'pose_landmarker_lite.task'), clips_dir=tmp_path / 'clips',
        attachments_dir=tmp_path / 'attachments', analysis_dir=tmp_path / 'analysis',
        admin_origins=('http://localhost:3000',))

    def transport(request):
        path = request.url.path
        if path == '/agent/v1/cameras':
            return httpx.Response(200, json={'cameras': [
                {'id': camera, 'name': camera, 'online': online, 'recording': online}
                for camera, online in state['online'].items()]})
        if path.endswith('/stream'):
            camera = path.split('/')[-2]
            return httpx.Response(200, json={'camera_id': camera, 'url': f'rtsp://192.0.2.12:8555/{camera}',
                                             'transport': 'tcp', 'authentication': 'separate'})
        if path == '/agent/v1/recordings':
            return httpx.Response(200, json={'camera_id': request.url.params['camera_id'], 'ranges': [
                {'start': '2026-01-01T00:00:00Z', 'duration': 10 ** 8}]})
        if path == '/agent/v1/recordings/export':
            payload = json.loads(request.content)
            body = bodies[payload['camera_id']]
            export_id = hashlib.md5(payload['camera_id'].encode()).hexdigest()
            state['exports'][export_id] = body
            return httpx.Response(201, json={
                'export_id': export_id, 'camera_id': payload['camera_id'], 'start': payload['start'],
                'requested_duration': payload['duration'], 'sha256': hashlib.sha256(body).hexdigest(),
                'bytes': len(body), 'download_path': '/agent/v1/exports/' + export_id,
                'created': '2026-10-22T01:00:00Z'})
        if path.startswith('/agent/v1/exports/'):
            return httpx.Response(200, content=state['exports'][path.rsplit('/', 1)[-1]])
        return httpx.Response(404)

    with httpx.Client(transport=httpx.MockTransport(transport)) as upstream:
        with TestClient(create_app(settings, adapter_http=upstream,
                                   intelligence=Intelligence(SimpleNamespace(openai_api_key='')))) as client:
            assert client.post('/api/v1/admin/agent/sync', headers=auth(ADMIN)).status_code == 200
            for camera, (latitude, longitude) in PLACES.items():
                response = client.put(f'/api/v1/admin/cameras/{camera}/location', headers=auth(ADMIN), json={
                    'latitude': latitude, 'longitude': longitude, 'kind': 'demo', 'approved': True,
                    'zone': 'BOOTH_Z' + camera[-1]})
                assert response.status_code == 200
            yield client, state, bodies


def analyze(client, report_id, **params):
    response = client.post(f'/api/v1/admin/reports/{report_id}/analyze', headers=auth(ADMIN),
                           json={'source': 'recording', 'duration': 3, 'sample_fps': 1, 'focus_fps': 3, **params})
    assert response.status_code == 202, response.text
    return wait(client, report_id)


def report(client, **changes):
    response = client.post('/api/v1/demo/reports', headers=auth(ADMIN), json={**FALL, **changes})
    assert response.status_code == 201
    return response.json()['report_id']


def test_selective_analysis_focuses_only_the_camera_showing_the_report(system):
    client, _, _ = system
    report_id = report(client)
    detail = analyze(client, report_id)
    assert detail['job']['state'] == 'completed', detail['job']
    analysis = detail['analysis']
    assert analysis['classification']['incident_type'] == 'FALL_SUSPECTED'
    assert analysis['outcome'] == 'REVIEW_REQUIRED'
    assert analysis['selected_camera_ids'] == ['cam-02']
    cameras = {row['camera_id']: row for row in analysis['cameras']}
    assert set(cameras) == {'cam-01', 'cam-02', 'cam-03'}
    assert all('scan' in row for row in cameras.values())
    assert 'focus' in cameras['cam-02'] and 'focus' not in cameras['cam-01'] and 'focus' not in cameras['cam-03']
    assert cameras['cam-02']['focus']['processed_frames'] > cameras['cam-02']['scan']['processed_frames']
    assert cameras['cam-03']['event_score'] == 0
    summary = analysis['summary']
    assert summary['requires_human_review'] is True and summary['source'] == 'local_rules'
    assert all(row['verified'] is False and row['camera_id'] == 'cam-02' for row in summary['cctv_observations'])
    stages = [event['message'] for event in detail['events'] if event['type'] == 'stage']
    assert stages == ['CLASSIFIED', 'CANDIDATES_FOUND', 'SCANNING', 'FOCUSED_ANALYSIS', 'SUMMARIZING']
    evidence = cameras['cam-02']['focus']['evidence'][0]
    image = client.get(f"/api/v1/admin/reports/{report_id}/artifacts/{evidence['path']}", headers=auth(ADMIN))
    assert image.status_code == 200 and image.content.startswith(b'\xff\xd8')
    assert client.get(f"/api/v1/admin/reports/{report_id}/artifacts/{evidence['path']}",
                      headers=auth(REPORTER)).status_code == 403
    assert client.get(f'/api/v1/admin/reports/{report_id}/artifacts/focus/cam-02/..%2Fsecret.jpg',
                      headers=auth(ADMIN)).status_code in (404, 422)
    # The automatic analysis cache is not a preserved clip.
    assert client.get(f'/api/v1/admin/reports/{report_id}/clips', headers=auth(ADMIN)).json()['clips'] == []


def test_selected_camera_changes_with_the_report(system):
    client, _, _ = system
    vehicle = report(client, description='승용차와 버스가 통행로를 막고 서 있어요')
    analysis = analyze(client, vehicle)['analysis']
    assert analysis['classification']['incident_type'] == 'VEHICLE_OBSTRUCTION'
    assert analysis['selected_camera_ids'] == ['cam-01']


def test_benchmark_compares_selective_and_full_analysis(system):
    client, _, _ = system
    report_id = report(client)
    analysis = analyze(client, report_id, mode='benchmark')['analysis']
    benchmark = analysis['benchmark']
    assert benchmark['selective']['selected'] == benchmark['all']['selected'] == ['cam-02']
    assert benchmark['same_selection'] is True
    assert benchmark['selective']['frames'] < benchmark['all']['frames']
    assert benchmark['frame_reduction'] > 0
    metrics = client.get('/api/v1/admin/metrics', headers=auth(ADMIN)).json()
    assert metrics['benchmarks'][0]['report_id'] == report_id
    assert metrics['latency_seconds']['count'] == 1
    assert metrics['outcomes'] == {'REVIEW_REQUIRED': 1}


def test_no_camera_in_range_and_offline_cameras_are_explicit(system):
    client, state, _ = system
    far = report(client, latitude=35.2, longitude=129.2)
    assert analyze(client, far)['analysis']['outcome'] == 'NO_CAMERA_IN_RANGE'
    for camera in state['online']:
        state['online'][camera] = False
    near = report(client)
    analysis = analyze(client, near)['analysis']
    assert analysis['outcome'] == 'NO_CAMERA_IN_RANGE'
    assert analysis['selected_camera_ids'] == []


def test_live_source_uses_authenticated_stream_capture(system, monkeypatch):
    client, _, bodies = system
    captured = []

    def fake_capture(url, user, password, seconds, target):
        # Substitute only the RTSP network read; frames still go through the real models.
        captured.append((url, user, password))
        target.write_bytes(bodies[url.rsplit('/', 1)[-1]])
    monkeypatch.setattr(worker_module, 'capture_live', fake_capture)
    analysis = analyze(client, report(client), source='live')['analysis']
    assert analysis['selected_camera_ids'] == ['cam-02']
    assert {url for url, _, _ in captured} == {f'rtsp://192.0.2.12:8555/cam-0{n}' for n in (1, 2, 3)}
    assert all(user == 'reader' and password == 'secret' for _, user, password in captured)
    assert all(row['window']['covers_report_time'] for row in analysis['cameras'])
    assert 'secret' not in json.dumps(analysis)


def test_vision_failure_is_reported_not_hidden(system):
    client, _, _ = system

    class Broken:
        def status(self):
            return {'models_present': True}

        def analyze_clip(self, *args, **kwargs):
            from vision import VisionUnavailable
            raise VisionUnavailable('CUDA was requested but PyTorch reports no CUDA device')
    client.app.state.worker.pipeline.vision = Broken()
    detail = analyze(client, report(client))
    assert detail['job']['state'] == 'failed'
    assert detail['job']['stage'] == 'MANUAL_REVIEW_REQUIRED'
    assert 'CUDA' in detail['job']['error']
    assert detail['analysis']['selected_camera_ids'] == []
    assert detail['analysis']['summary']['requires_human_review'] is True


def test_attachments_require_consent_type_and_ownership(system):
    client, _, _ = system
    response = client.post('/api/v1/reports', headers=auth(REPORTER), json={**FALL, 'location_kind': 'real'})
    report_id = response.json()['report_id']
    url = f'/api/v1/reports/{report_id}/attachments'
    files = {'file': ('photo.jpg', JPEG, 'image/jpeg')}
    assert client.post(url, headers=auth(REPORTER), files=files, data={'consent': 'false'}).status_code == 422
    assert client.post(url, headers=auth(REPORTER), files=files).status_code == 422
    assert client.post(url, headers=auth(REPORTER), data={'consent': 'true'},
                       files={'file': ('x.jpg', b'MZ fake executable', 'image/jpeg')}).status_code == 415
    assert client.post(url, headers=auth(OTHER), files=files, data={'consent': 'true'}).status_code == 404
    created = client.post(url, headers=auth(REPORTER), files=files, data={'consent': 'true'})
    assert created.status_code == 201, created.text
    body = created.json()
    assert body['kind'] == 'image' and body['sha256'] == hashlib.sha256(JPEG).hexdigest()
    assert 'stored_name' not in body
    download = client.get(body['download_path'], headers=auth(REPORTER))
    assert download.status_code == 200 and download.content == JPEG
    assert client.get(body['download_path'], headers=auth(OTHER)).status_code == 404
    detail = client.get(f'/api/v1/admin/reports/{report_id}', headers=auth(ADMIN)).json()
    assert [row['attachment_id'] for row in detail['attachments']] == [body['attachment_id']]


def test_review_confirm_close_and_status_privacy(system):
    client, _, _ = system
    report_id = report(client)
    assert client.post(f'/api/v1/admin/reports/{report_id}/confirm', headers=auth(REPORTER),
                       json={'note': 'x'}).status_code == 403
    confirmed = client.post(f'/api/v1/admin/reports/{report_id}/confirm', headers=auth(ADMIN),
                            json={'note': '원본 확인함'})
    assert confirmed.status_code == 200 and confirmed.json()['confirmed_by'] == 'operator'
    closed = client.post(f'/api/v1/admin/reports/{report_id}/close', headers=auth(ADMIN), json={'note': '종결'})
    assert closed.json()['closed_at'] is not None
    detail = client.get(f'/api/v1/admin/reports/{report_id}', headers=auth(ADMIN)).json()
    assert detail['review']['confirm_note'] == '원본 확인함'
    assert [event['type'] for event in detail['events']][-2:] == ['confirmed', 'closed']


def test_websocket_requires_single_use_ticket_and_allowed_origin(system):
    client, _, _ = system
    ticket = client.post('/api/v1/admin/ws-ticket', headers=auth(ADMIN)).json()['ticket']
    assert client.post('/api/v1/admin/ws-ticket', headers=auth(REPORTER)).status_code == 403
    with client.websocket_connect('/ws/v1/admin', headers={'origin': 'http://localhost:3000'}) as socket:
        socket.send_json({'ticket': ticket})
        message = socket.receive_json()
        assert message['type'] == 'snapshot'
        assert {camera['id'] for camera in message['cameras']} == set(PLACES)
    from starlette.websockets import WebSocketDisconnect
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect('/ws/v1/admin') as socket:
            socket.send_json({'ticket': ticket})  # already used
            socket.receive_json()
    fresh = client.post('/api/v1/admin/ws-ticket', headers=auth(ADMIN)).json()['ticket']
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect('/ws/v1/admin', headers={'origin': 'https://evil.example'}) as socket:
            socket.send_json({'ticket': fresh})
            socket.receive_json()


def test_snapshot_requires_approved_demo_webcam(system):
    client, _, _ = system
    assert client.put('/api/v1/admin/cameras/cam-03/location', headers=auth(ADMIN), json={
        'latitude': 35.1, 'longitude': 129.1, 'kind': 'demo', 'approved': False}).status_code == 200
    assert client.get('/api/v1/admin/cameras/cam-03/snapshot', headers=auth(ADMIN)).status_code == 403
    assert client.get('/api/v1/admin/cameras/cam-09/snapshot', headers=auth(ADMIN)).status_code == 404


def test_intake_queues_automatic_analysis_when_worker_enabled(tmp_path):
    settings = SimpleNamespace(database_path=tmp_path / 'db.sqlite3', tokens=TOKENS, adapter_url='',
                               adapter_token='', worker_enabled=True, auto_analyze=True,
                               analysis_dir=tmp_path / 'analysis', attachments_dir=tmp_path / 'attachments')

    class Idle:
        def status(self):
            return {'models_present': True}
    with TestClient(create_app(settings, vision=Idle(),
                               intelligence=Intelligence(SimpleNamespace(openai_api_key='')))) as client:
        created = client.post('/api/v1/reports', headers=auth(REPORTER), json=FALL).json()
        assert created['job']['params']['source'] == 'live'
        past = client.post('/api/v1/reports', headers=auth(REPORTER),
                           json={**FALL, 'occurred_at': '2026-01-01T00:00:00+09:00'}).json()
        assert past['job']['params']['source'] == 'recording'
        detail = wait(client, created['report_id'])
        # A is not configured: the report is still received and the outcome says why.
        assert detail['analysis']['outcome'] == 'CAMERA_UNAVAILABLE'
        status = client.get(f"/api/v1/reports/{created['report_id']}/status", headers=auth(REPORTER)).json()
        assert status['job']['stage'] == 'CAMERA_UNAVAILABLE' and 'params' not in status['job']


def test_latency_is_measured_from_the_analysis_request(system):
    client, _, _ = system
    report_id = report(client)
    time.sleep(1.5)
    analysis = analyze(client, report_id)['analysis']
    detail_created = client.get(f'/api/v1/admin/reports/{report_id}', headers=auth(ADMIN)).json()['created_at']
    assert analysis['requested_at'] > detail_created
    assert analysis['latency_seconds'] < analysis['processing_seconds'] + 1.5


def test_analysis_guides_the_radius_cctv_and_recommends_a_response(system):
    client, _, _ = system
    report_id = report(client)
    nearby = client.get(f'/api/v1/admin/reports/{report_id}/nearby', headers=auth(ADMIN))
    assert nearby.status_code == 200
    assert nearby.json()['webcams']['total'] == 3 and nearby.json()['radius_m'] == 100
    assert client.get(f'/api/v1/admin/reports/{report_id}/nearby', headers=auth(REPORTER)).status_code == 403
    analysis = analyze(client, report_id)['analysis']
    assert analysis['nearby']['webcams']['total'] == 3
    assert {row['id'] for row in analysis['nearby']['webcams']['cameras']} == {'cam-01', 'cam-02', 'cam-03'}
    assert analysis['nearby']['public']['purposes'] in ({}, {'생활방범': analysis['nearby']['public']['devices']})
    best = analysis['best_camera']['video']
    assert best['camera_id'] == 'cam-02' and best['latitude'] == PLACES['cam-02'][0]
    plan = analysis['response_plan']
    assert plan['priority'] == 'urgent' and '119' in plan['steps'][0]['action']
    assert any('cam-02 근거 프레임' in step['action'] for step in plan['steps'])


def test_response_log_handling_status_and_incident_metrics(system):
    client, _, _ = system
    report_id = report(client)
    plan = analyze(client, report_id)['analysis']['response_plan']
    path = f'/api/v1/admin/reports/{report_id}/log'
    logged = client.post(path, headers=auth(ADMIN), json={'kind': 'step', 'step': 0})
    assert logged.status_code == 201 and logged.json()['text'] == plan['steps'][0]['action']
    assert client.post(path, headers=auth(ADMIN), json={'kind': 'step', 'step': 40}).status_code == 409
    assert client.post(path, headers=auth(ADMIN), json={'kind': 'note'}).status_code == 422
    assert client.post(path, headers=auth(REPORTER), json={'kind': 'alert_ack'}).status_code == 403
    assert client.post(path, headers=auth(ADMIN), json={'kind': 'alert_ack'}).status_code == 201
    events = client.get(f'/api/v1/admin/reports/{report_id}', headers=auth(ADMIN)).json()['events']
    logs = [event for event in events if event['type'] == 'response_log']
    assert [event['message'] for event in logs] == ['대응 단계 1 실행', '긴급 알림 확인']
    view = client.get(f'/api/v1/reports/{report_id}', headers=auth(ADMIN)).json()['handling']
    assert view['state'] == 'responding' and 'by' not in str(view)
    client.post(f'/api/v1/admin/reports/{report_id}/confirm', headers=auth(ADMIN), json={'note': '원본 확인'})
    assert client.get(f'/api/v1/reports/{report_id}', headers=auth(ADMIN)).json()['handling']['state'] == 'confirmed'
    metrics = client.get('/api/v1/admin/metrics', headers=auth(ADMIN)).json()
    fall = metrics['by_incident']['FALL_SUSPECTED']
    assert fall['count'] == 1 and fall['review_required'] == 1 and fall['mean_frames'] > 0
