"""Citizen app support: ID/password accounts, own-report views, location-only reports,
and phone attachments feeding the analysis (voice-first classification, photo vision, re-run)."""
from pathlib import Path
import sqlite3

import pytest

from store import Store
from models import AnalyzeInput, ReportInput
from test_server import ADMIN, REPORT, REPORTER, auth, client, settings  # noqa: F401 - fixtures
from test_pipeline import FALL, analyze, system, wait  # noqa: F401 - fixtures
from test_vision import clips  # noqa: F401 - fixture

PASSWORD = 'harbour-light-42'


def signup(client, username='busansafe01', password=PASSWORD):  # noqa: F811
    response = client.post('/api/v1/auth/signup', json={'username': username, 'password': password})
    assert response.status_code == 201, response.text
    return response.json()['token']


def test_signup_login_logout_and_token_storage(client, settings):  # noqa: F811
    token = signup(client)
    assert client.get('/api/v1/auth/me', headers=auth(token)).json() == {'username': 'busansafe01'}
    assert client.post('/api/v1/auth/signup', json={'username': 'busansafe01', 'password': PASSWORD}).status_code == 409
    for bad in ({'username': 'AB', 'password': PASSWORD}, {'username': 'ok_name!', 'password': PASSWORD},
                {'username': 'busansafe02', 'password': 'short'}):
        assert client.post('/api/v1/auth/signup', json=bad).status_code == 422
    assert client.post('/api/v1/auth/login', json={'username': 'busansafe01', 'password': 'wrong-password'}).status_code == 401
    assert client.post('/api/v1/auth/login', json={'username': 'nobody99', 'password': PASSWORD}).status_code == 401
    second = client.post('/api/v1/auth/login', json={'username': 'busansafe01', 'password': PASSWORD}).json()['token']
    assert second != token
    # Reporter tokens never reach admin APIs.
    assert client.get('/api/v1/admin/status', headers=auth(token)).status_code == 403
    assert client.post('/api/v1/auth/logout', headers=auth(token)).status_code == 204
    assert client.get('/api/v1/auth/me', headers=auth(token)).status_code == 401
    assert client.get('/api/v1/auth/me', headers=auth(second)).status_code == 200
    with sqlite3.connect(settings.database_path) as database:
        dump = '\n'.join(database.iterdump())
    assert token not in dump and second not in dump and PASSWORD not in dump
    assert 'scrypt$' in dump


def test_failed_logins_are_rate_limited(client):  # noqa: F811
    signup(client)
    for _ in range(5):
        assert client.post('/api/v1/auth/login', json={'username': 'busansafe01', 'password': 'not-it-at-all'}).status_code == 401
    blocked = client.post('/api/v1/auth/login', json={'username': 'busansafe01', 'password': PASSWORD})
    assert blocked.status_code == 429


def test_admin_password_reset_revokes_tokens(client):  # noqa: F811
    token = signup(client)
    url = '/api/v1/admin/reporters/busansafe01/password'
    assert client.post(url, headers=auth(token), json={'password': 'new-password-1'}).status_code == 403
    assert client.post('/api/v1/admin/reporters/nobody99/password', headers=auth(ADMIN),
                       json={'password': 'new-password-1'}).status_code == 404
    assert client.post(url, headers=auth(ADMIN), json={'password': 'new-password-1'}).status_code == 204
    assert client.get('/api/v1/auth/me', headers=auth(token)).status_code == 401
    assert client.post('/api/v1/auth/login', json={'username': 'busansafe01', 'password': PASSWORD}).status_code == 401
    assert client.post('/api/v1/auth/login', json={'username': 'busansafe01',
                                                   'password': 'new-password-1'}).status_code == 200


def test_location_only_report_and_own_report_views(client):  # noqa: F811
    mine, other = signup(client), signup(client, 'neighbor22')
    location_only = {'latitude': 35.1336, 'longitude': 129.103, 'gps_latitude': 35.1337,
                     'gps_longitude': 129.1031, 'gps_accuracy_m': 12}
    created = client.post('/api/v1/reports', headers=auth(mine), json=location_only)
    assert created.status_code == 201, created.text
    report_id = created.json()['report_id']
    assert client.post('/api/v1/reports', headers=auth(mine),
                       json={'latitude': 35.1, 'longitude': 129.1, 'gps_latitude': 35.1}).status_code == 422
    listed = client.get('/api/v1/reports', headers=auth(mine)).json()['reports']
    assert [row['report_id'] for row in listed] == [report_id]
    row = listed[0]
    assert row['description'] == '' and row['gps_accuracy_m'] == 12
    assert set(row['job']) == {'state', 'stage', 'progress', 'error'}
    assert 'owner' not in row and 'analysis' not in row
    assert client.get(f'/api/v1/reports/{report_id}', headers=auth(mine)).json()['report_id'] == report_id
    assert client.get('/api/v1/reports', headers=auth(other)).json()['reports'] == []
    assert client.get(f'/api/v1/reports/{report_id}', headers=auth(other)).status_code == 404
    # Settings-file reporter tokens keep working.
    assert client.post('/api/v1/reports', headers=auth(REPORTER), json=REPORT).status_code == 201


def test_attachment_during_analysis_defers_one_rerun(tmp_path):
    store = Store(tmp_path / 'db.sqlite3')
    params = AnalyzeInput().model_dump()
    report = store.create_report(ReportInput(latitude=35.1, longitude=129.1), 'reporter:a', 'reporter', params)
    report_id = report['report_id']
    job = store.claim_job()
    assert job['report_id'] == report_id
    assert store.request_rerun(report_id) is True
    assert store.report(report_id)['job']['state'] == 'running'
    store.update_job(job['id'], 'REVIEW_REQUIRED', 1.0, state='completed')
    assert store.take_rerun(report_id) is True
    rerun = store.report(report_id)['job']
    assert rerun['state'] == 'queued' and rerun['params'] == params and rerun['rerun'] == 0
    assert store.take_rerun(report_id) is False
    assert [e['type'] for e in store.events(report_id)][-1] == 'analysis_rerun'
    # Not running: the re-run is queued straight away.
    store.claim_job()
    store.update_job(job['id'], 'REVIEW_REQUIRED', 1.0, state='completed')
    assert store.request_rerun(report_id) is True
    assert store.report(report_id)['job']['state'] == 'queued'


def test_voice_classifies_location_only_report_and_photo_is_analyzed(system):  # noqa: F811
    client, _, _ = system
    pipeline = client.app.state.worker.pipeline
    heard = []

    def transcribe(path):
        heard.append(Path(path).suffix)
        return {'text': '정문 복도에 사람이 쓰러져 있어요', 'source': 'test', 'warnings': []}
    pipeline.intelligence.transcribe = transcribe
    token = signup(client)
    created = client.post('/api/v1/reports', headers=auth(token),
                          json={'latitude': FALL['latitude'], 'longitude': FALL['longitude'], 'location_kind': 'demo',
                                'radius_m': 100})
    report_id = created.json()['report_id']
    url = f'/api/v1/reports/{report_id}/attachments'
    wav = b'RIFF' + b'\x24\x00\x00\x00' + b'WAVEfmt ' + b'\x00' * 40
    import ultralytics
    photo = (Path(ultralytics.__file__).parent / 'assets' / 'bus.jpg').read_bytes()
    for name, body, kind in (('voice.wav', wav, 'audio/wav'), ('photo.jpg', photo, 'image/jpeg')):
        response = client.post(url, headers=auth(token), files={'file': (name, body, kind)}, data={'consent': 'true'})
        assert response.status_code == 201, response.text
    detail = analyze(client, report_id)
    analysis = detail['analysis']
    assert heard == ['.wav']
    assert analysis['classification']['incident_type'] == 'FALL_SUSPECTED'
    image = next(row for row in analysis['phone'] if row['kind'] == 'image')
    assert any(item['kind'] == 'person' for item in image['analysis']['observations'])
    evidence = image['analysis']['evidence'][0]['path']
    assert evidence.startswith('phone/')
    assert client.get(f'/api/v1/admin/reports/{report_id}/artifacts/{evidence}', headers=auth(ADMIN)).status_code == 200
    assert any(text.startswith('신고자 사진:') for text in analysis['summary']['phone_observations'])
    assert analysis['summary']['reporter_claim'].startswith('(신고문 없음')
    # The citizen sees status only, never the analysis.
    mine = client.get(f'/api/v1/reports/{report_id}', headers=auth(token)).json()
    assert 'analysis' not in mine and len(mine['attachments']) == 2
