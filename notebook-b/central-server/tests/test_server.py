import json
import sqlite3
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient

from app import create_app

ADMIN = 'admin-test-' + 'a' * 32
REPORTER = 'reporter-test-' + 'b' * 32
OTHER = 'other-test-' + 'c' * 32
AGENT = 'agent-test-' + 'd' * 32
TOKENS = {
    ADMIN: {'role': 'admin', 'subject': 'operator'},
    REPORTER: {'role': 'reporter', 'subject': 'citizen-1'},
    OTHER: {'role': 'reporter', 'subject': 'citizen-2'},
    AGENT: {'role': 'agent', 'subject': 'worker-1'},
}
REPORT = {'description': '버스 정류장 옆에 사람이 누워 있습니다',
          'latitude': 37.5, 'longitude': 127.0, 'details': '입구 옆',
          'occurred_at': '2026-10-22T10:00:00+09:00', 'radius_m': 200}


def auth(token):
    return {'Authorization': f'Bearer {token}'}


@pytest.fixture
def settings(tmp_path):
    return SimpleNamespace(database_path=tmp_path / 'central.sqlite3', tokens=TOKENS,
                           adapter_url='', adapter_token='')


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as instance:
        yield instance


def submit(client, token=REPORTER, **changes):
    path = '/api/v1/demo/reports' if token == ADMIN else '/api/v1/reports'
    response = client.post(path, headers=auth(token), json={**REPORT, **changes})
    assert response.status_code == 201, response.text
    return response.json()


def test_role_boundaries_and_no_default_access(client):
    assert client.get('/health').json() == {'status': 'ok'}
    assert client.get('/api/v1/admin/status').status_code == 401
    assert client.get('/api/v1/admin/status', headers=auth('bad')).status_code == 401
    for token in (REPORTER, AGENT):
        assert client.get('/api/v1/admin/status', headers=auth(token)).status_code == 403
        assert client.post('/api/v1/demo/reports', json=REPORT, headers=auth(token)).status_code == 403
    assert client.post('/api/v1/reports', json=REPORT, headers=auth(AGENT)).status_code == 403
    status = client.get('/api/v1/admin/status', headers=auth(ADMIN)).json()
    assert status['ai_worker_available'] is False
    assert status['adapter_configured'] is False


def test_report_and_job_survive_restart_and_demo_uses_same_pipeline(client, settings):
    real = submit(client)
    demo = submit(client, ADMIN, location_kind='demo')
    assert real['source'] == 'reporter'
    assert demo['source'] == 'demo'
    assert real['job']['state'] == demo['job']['state'] == 'queued'
    assert real['job']['stage'] == demo['job']['stage'] == 'awaiting_worker'
    assert real['job']['progress'] == 0
    with TestClient(create_app(settings)) as restarted:
        detail = restarted.get('/api/v1/admin/reports/' + real['report_id'], headers=auth(ADMIN)).json()
        assert detail['description'] == REPORT['description']
        assert detail['occurred_at'] == '2026-10-22T01:00:00Z'
        assert detail['job']['id'] == real['job']['id']
        rows = restarted.get('/api/v1/admin/reports', headers=auth(ADMIN)).json()['reports']
        assert {row['report_id'] for row in rows} == {real['report_id'], demo['report_id']}
        jobs = restarted.get('/api/v1/agent/jobs', headers=auth(AGENT)).json()['jobs']
        assert {job['report_id'] for job in jobs} == {real['report_id'], demo['report_id']}
        assert restarted.get('/api/v1/agent/jobs', headers=auth(REPORTER)).status_code == 403


def test_reporter_can_only_read_own_status(client):
    report = submit(client)
    url = '/api/v1/reports/' + report['report_id'] + '/status'
    status = client.get(url, headers=auth(REPORTER))
    assert status.status_code == 200
    assert status.json()['job']['state'] == 'queued'
    assert 'description' not in status.json()
    assert client.get(url, headers=auth(OTHER)).status_code == 404
    assert client.get(url, headers=auth(AGENT)).status_code == 403
    assert client.get('/api/v1/admin/reports/' + report['report_id'], headers=auth(REPORTER)).status_code == 403


@pytest.mark.parametrize('changes', [
    {'description': '   '}, {'description': 'x' * 4001}, {'latitude': 91},
    {'longitude': -181}, {'radius_m': 0}, {'radius_m': 5001},
    {'occurred_at': '2026-10-22T10:00:00'}, {'location_kind': 'invented'},
    {'latitude': None}, {'unexpected_field': 'discarding this hides client errors'},
])
def test_invalid_reports_do_not_create_jobs(client, changes):
    response = client.post('/api/v1/reports', json={**REPORT, **changes}, headers=auth(REPORTER))
    assert response.status_code == 422
    assert client.get('/api/v1/agent/jobs', headers=auth(AGENT)).json()['jobs'] == []


@pytest.fixture
def connected(settings):
    settings.adapter_url = 'https://a.test'
    settings.adapter_token = 'a-adapter-test-' + 'e' * 32
    camera_rows = [
        {'id': 'cam-01', 'name': '내장 카메라', 'online': True, 'recording': True,
         'device_path': 'LOCAL-USB-SECRET', 'token': 'MUST-NOT-LEAK'},
        {'id': 'cam-02', 'name': 'USB 1', 'online': True, 'recording': True},
        {'id': 'cam-03', 'name': 'USB 2', 'online': False, 'recording': False},
    ]
    state = {'status': 200, 'cameras': camera_rows, 'bad_json': False}

    def transport(request):
        # External A transport only is substituted; B auth, DB and HTTP routing are real.
        if request.headers.get('Authorization') != 'Bearer ' + settings.adapter_token:
            return httpx.Response(401, json={'error': 'Unauthorized'})
        if state['status'] != 200:
            return httpx.Response(state['status'], text='private upstream diagnostic')
        if state['bad_json']:
            return httpx.Response(200, text='not json')
        if request.url.path == '/agent/v1/cameras':
            return httpx.Response(200, json={'cameras': state['cameras']})
        if request.url.path == '/agent/v1/recordings':
            assert dict(request.url.params) == {'camera_id': 'cam-01',
                                                'start': '2026-10-22T01:00:00Z',
                                                'end': '2026-10-22T01:01:00Z'}
            return httpx.Response(200, json={'camera_id': 'cam-01', 'ranges': [
                {'start': '2026-10-22T01:00:00Z', 'duration': 60}]})
        return httpx.Response(404)

    with httpx.Client(transport=httpx.MockTransport(transport)) as upstream:
        with TestClient(create_app(settings, adapter_http=upstream)) as instance:
            yield instance, state


def sync(client):
    return client.post('/api/v1/admin/agent/sync', headers=auth(ADMIN))


def test_adapter_sync_preserves_ids_but_strips_device_paths_and_secrets(connected):
    client, _ = connected
    response = sync(client)
    assert response.status_code == 200, response.text
    rows = client.get('/api/v1/admin/cameras', headers=auth(ADMIN)).json()['cameras']
    assert [row['id'] for row in rows] == ['cam-01', 'cam-02', 'cam-03']
    assert rows[0]['name'] == '내장 카메라'
    assert rows[0]['latitude'] is None
    assert rows[0]['approved'] is False
    assert rows[2]['online'] is False
    assert 'LOCAL-USB-SECRET' not in json.dumps(rows)
    assert 'MUST-NOT-LEAK' not in json.dumps(rows)


def test_adapter_unconfigured_or_failed_does_not_block_report_intake(client, connected):
    assert sync(client).status_code == 503
    active, state = connected
    assert sync(active).status_code == 200
    state['status'] = 401
    response = sync(active)
    assert response.status_code == 503
    assert 'private upstream diagnostic' not in response.text
    assert all(not row['online'] for row in active.get('/api/v1/admin/cameras', headers=auth(ADMIN)).json()['cameras'])
    assert submit(active)['job']['state'] == 'queued'


@pytest.mark.parametrize('bad', ['json', 'type', 'duplicate'])
def test_invalid_adapter_payload_is_rejected_atomically(connected, bad):
    client, state = connected
    assert sync(client).status_code == 200
    if bad == 'json':
        state['bad_json'] = True
    elif bad == 'type':
        state['cameras'][1]['online'] = 'yes'
    else:
        state['cameras'].append(dict(state['cameras'][0]))
    assert sync(client).status_code == 502
    rows = client.get('/api/v1/admin/cameras', headers=auth(ADMIN)).json()['cameras']
    assert len(rows) == 3


def locate(client, camera, **changes):
    return client.put('/api/v1/admin/cameras/' + camera + '/location', headers=auth(ADMIN),
                      json={'latitude': 37.5, 'longitude': 127.0, 'kind': 'real',
                            'approved': True, **changes})


def test_candidates_require_approved_fresh_online_matching_coordinates(connected, settings):
    client, state = connected
    report = submit(client)
    url = '/api/v1/admin/reports/' + report['report_id'] + '/candidates'
    assert sync(client).status_code == 200
    assert client.get(url, headers=auth(ADMIN)).json()['cameras'] == []
    assert locate(client, 'cam-01', approved=False).status_code == 200
    assert locate(client, 'cam-02', longitude=128.0).status_code == 200
    assert locate(client, 'cam-03').status_code == 200
    assert client.get(url, headers=auth(ADMIN)).json()['cameras'] == []
    assert locate(client, 'cam-01', kind='demo').status_code == 200
    assert client.get(url, headers=auth(ADMIN)).json()['cameras'] == []
    assert locate(client, 'cam-01').status_code == 200
    # Resync must preserve the manually registered location/approval.
    assert sync(client).status_code == 200
    candidates = client.get(url, headers=auth(ADMIN)).json()['cameras']
    assert [row['id'] for row in candidates] == ['cam-01']
    assert candidates[0]['distance_m'] == 0
    with sqlite3.connect(settings.database_path) as database:
        database.execute("UPDATE cameras SET synced_at='2000-01-01T00:00:00Z'")
    assert client.get(url, headers=auth(ADMIN)).json()['cameras'] == []


def test_unknown_cameras_and_invalid_locations_are_rejected(connected):
    client, _ = connected
    assert locate(client, 'missing').status_code == 404
    assert sync(client).status_code == 200
    assert locate(client, 'cam-01', latitude=100).status_code == 422
    assert locate(client, 'cam-01', approved='yes').status_code == 422


def test_recordings_validate_time_range_and_forward_utc(connected):
    client, _ = connected
    sync(client)
    query = {'camera_id': 'cam-01', 'start': '2026-10-22T10:00:00+09:00',
             'end': '2026-10-22T10:01:00+09:00'}
    response = client.get('/api/v1/admin/recordings', headers=auth(ADMIN), params=query)
    assert response.status_code == 200, response.text
    assert response.json()['ranges'][0]['duration'] == 60
    for changes in ({'start': '2026-10-22T10:00:00'}, {'end': query['start']},
                    {'camera_id': '../cam-01'}):
        response = client.get('/api/v1/admin/recordings', headers=auth(ADMIN), params={**query, **changes})
        assert response.status_code in (404, 422)
