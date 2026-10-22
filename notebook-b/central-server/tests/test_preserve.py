import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess

from fastapi.testclient import TestClient
import httpx
import pytest

from app import create_app
from adapter import AdapterError
from media import inspect_clip
from test_server import ADMIN, REPORTER, auth, settings, submit


@pytest.fixture(scope='module')
def mp4(tmp_path_factory):
    root = Path(__file__).resolve().parents[1]
    ffmpeg = next((root / 'tools/ffmpeg').rglob('ffmpeg.exe'), None)
    if ffmpeg is None:
        pytest.skip('Run B setup_tools.py to enable actual video validation tests')
    target = tmp_path_factory.mktemp('synthetic') / 'test.mp4'
    subprocess.run([str(ffmpeg), '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=32x32:r=10',
                    '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(target)],
                   check=True, capture_output=True, timeout=20)
    return target.read_bytes()


@pytest.fixture
def preservation(settings, mp4, tmp_path):
    settings.adapter_url = 'https://a.test'
    settings.adapter_token = 'private-a-token'
    settings.clips_dir = tmp_path / 'clips'
    state = {'body': mp4, 'failure': None, 'ranges': True, 'export_status': 201}
    export_id = 'f' * 32

    def transport(request):
        assert request.headers['Authorization'] == 'Bearer private-a-token'
        if request.url.path == '/agent/v1/cameras':
            return httpx.Response(200, json={'cameras': [
                {'id': 'cam-01', 'name': 'Test camera', 'online': True, 'recording': True}]})
        if request.url.path == '/agent/v1/health':
            return httpx.Response(200, json={'disk_free_gb': 200.0, 'disk_low': False,
                'cameras': [{'id': 'cam-01', 'name': 'Test camera', 'online': True, 'recording': True}],
                'private_path': 'DO-NOT-EXPOSE'})
        if request.url.path == '/agent/v1/recordings':
            return httpx.Response(200, json={'camera_id': 'cam-01', 'ranges': [
                {'start': state.get('range_start', '2026-10-22T01:00:00Z'),
                 'duration': state.get('range_duration', 10)}] if state['ranges'] else []})
        if request.url.path == '/agent/v1/recordings/export':
            assert request.method == 'POST'
            payload = json.loads(request.content)
            assert payload == {'camera_id': 'cam-01', 'start': '2026-10-22T01:00:00Z', 'duration': 2.0}
            body = state['body']
            metadata = {'export_id': export_id, 'camera_id': 'cam-01', 'start': payload['start'],
                        'requested_duration': payload['duration'], 'sha256': hashlib.sha256(body).hexdigest(),
                        'bytes': len(body), 'download_path': '/agent/v1/exports/' + export_id,
                        'source': 'A original recording; remuxed MP4 derivative',
                        'created': '2026-10-22T01:00:00Z'}
            if state['failure'] == 'hash':
                metadata['sha256'] = '0' * 64
            if state['failure'] == 'size':
                metadata['bytes'] += 10
            if state['failure'] == 'path':
                metadata['download_path'] = 'https://attacker.example/leak'
            if state['failure'] == 'identity':
                metadata['camera_id'] = 'cam-02'
            if state['failure'] == 'oversize':
                metadata['bytes'] = 2 * 1024 ** 3 + 1
            return httpx.Response(state['export_status'], json=metadata)
        if request.url.path == '/agent/v1/exports/' + export_id:
            return httpx.Response(200, content=state['body'], headers={'Content-Type': 'video/mp4'})
        return httpx.Response(404)

    with httpx.Client(transport=httpx.MockTransport(transport)) as upstream:
        with TestClient(create_app(settings, adapter_http=upstream)) as client:
            report = submit(client, ADMIN, location_kind='demo')
            client.post('/api/v1/admin/agent/sync', headers=auth(ADMIN))
            yield client, report['report_id'], state, settings


def approve(client, **changes):
    return client.put('/api/v1/admin/cameras/cam-01/location', headers=auth(ADMIN),
                      json={'latitude': 37.5, 'longitude': 127.0, 'kind': 'demo',
                            'approved': True, **changes})


def preserve(client, report_id, **changes):
    return client.post('/api/v1/admin/reports/' + report_id + '/preserve', headers=auth(ADMIN),
                       json={'camera_id': 'cam-01', 'start': '2026-10-22T01:00:00Z',
                             'duration': 2, **changes})


def test_verified_clip_is_persistent_downloadable_and_audited(preservation, mp4):
    client, report_id, _, settings = preservation
    assert approve(client).status_code == 200
    response = preserve(client, report_id)
    assert response.status_code == 201, response.text
    clip = response.json()
    assert clip['sha256'] == hashlib.sha256(mp4).hexdigest()
    assert clip['bytes'] == len(mp4)
    assert abs(clip['measured_duration'] - 2) < 0.1
    assert clip['duration_matches_request'] is True
    assert clip['recording_ranges_cover_request'] is True
    assert clip['source'] == 'A recording export; remuxed derivative'
    assert 'private-a-token' not in response.text
    assert str(settings.clips_dir) not in response.text
    downloaded = client.get(clip['download_path'], headers=auth(ADMIN))
    assert downloaded.status_code == 200
    assert downloaded.content == mp4
    assert client.get(clip['download_path']).status_code == 401
    partial = client.get(clip['download_path'], headers={**auth(ADMIN), 'Range': 'bytes=0-9'})
    assert partial.status_code == 206
    assert partial.content == mp4[:10]
    assert client.get(clip['download_path'], headers=auth(REPORTER)).status_code == 403
    with TestClient(create_app(settings)) as restarted:
        rows = restarted.get('/api/v1/admin/reports/' + report_id + '/clips', headers=auth(ADMIN)).json()['clips']
        assert rows[0]['clip_id'] == clip['clip_id']
    with sqlite3.connect(settings.database_path) as database:
        events = database.execute('SELECT event,actor FROM audit_events ORDER BY rowid').fetchall()
    assert ('clip_preserved', 'operator') in events
    assert ('clip_downloaded', 'operator') in events
    # Tampered preserved data must not be served as the verified clip.
    (settings.clips_dir / (clip['clip_id'] + '.mp4')).write_bytes(b'tampered')
    assert client.get(clip['download_path'], headers=auth(ADMIN)).status_code == 409


def test_preservation_requires_registered_approved_matching_camera(preservation):
    client, report_id, _, _ = preservation
    assert preserve(client, report_id).status_code == 403
    approve(client, kind='real')
    assert preserve(client, report_id).status_code == 403
    approve(client)
    assert preserve(client, 'not-found').status_code == 404
    assert preserve(client, report_id, camera_id='missing').status_code == 404
    assert client.post('/api/v1/admin/reports/' + report_id + '/preserve',
                       headers=auth(REPORTER), json={}).status_code == 403


@pytest.mark.parametrize('failure', ['hash', 'size', 'path', 'identity', 'oversize', 'invalid_video'])
def test_failed_clip_is_not_committed_or_left_on_disk(preservation, failure):
    client, report_id, state, settings = preservation
    approve(client)
    state['failure'] = failure
    if failure == 'invalid_video':
        state['body'] = b'not a video, even though hash and bytes match'
    assert preserve(client, report_id).status_code == 502
    rows = client.get('/api/v1/admin/reports/' + report_id + '/clips', headers=auth(ADMIN)).json()['clips']
    assert rows == []
    assert not list(settings.clips_dir.glob('*'))


def test_recording_gap_or_upstream_busy_is_explicit(preservation):
    client, report_id, state, _ = preservation
    approve(client)
    state['ranges'] = False
    assert preserve(client, report_id).status_code == 409
    state['ranges'] = True
    state['export_status'] = 429
    assert preserve(client, report_id).status_code == 429


@pytest.mark.parametrize('changes', [{'duration': 0}, {'duration': 3601},
                                   {'start': '2026-10-22T01:00:00'}, {'camera_id': '../cam-01'},
                                   {'start': '9999-12-31T23:59:59Z'},
                                   {'start': '0001-01-01T00:00:00+09:00'}])
def test_preserve_rejects_invalid_requests(preservation, changes):
    client, report_id, _, _ = preservation
    approve(client)
    assert preserve(client, report_id, **changes).status_code == 422


@pytest.mark.parametrize('changes', [{'range_duration': 1e308},
                                   {'range_start': '9999-12-31T23:59:59Z'}])
def test_unrepresentable_upstream_recording_range_is_rejected(preservation, changes):
    client, report_id, state, _ = preservation
    approve(client)
    state.update(changes)
    assert preserve(client, report_id).status_code == 502


def test_health_fields_are_filtered(preservation):
    client, _, _, _ = preservation
    result = client.get('/api/v1/admin/agent/health', headers=auth(ADMIN))
    assert result.status_code == 200
    assert result.json()['cameras'][0]['id'] == 'cam-01'
    assert 'DO-NOT-EXPOSE' not in result.text


def test_export_must_be_self_contained_mp4_not_a_local_file_manifest(tmp_path, mp4):
    reference = tmp_path / 'local.mp4'
    reference.write_bytes(mp4)
    manifest = tmp_path / 'export.partial'
    manifest.write_text('ffconcat version 1.0\nfile local.mp4\nduration 2\n')
    with pytest.raises(AdapterError, match='readable video'):
        inspect_clip(manifest)
