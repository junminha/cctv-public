"""Evidence contracts: temporary DB/storage and synthetic media only."""
import hashlib
import io
import re
import sqlite3
from urllib.parse import parse_qs, urlsplit

import pytest

from test_exports import client, settings
from test_server import ADMIN, OTHER, REPORTER, auth, submit

VERSION = '2026-10-26T00:00:00Z'
JPEG = b'\xff\xd8\xff\xe0' + b'synthetic image' * 12
VIDEO = b'\x00\x00\x00\x18ftypmp42' + bytes(range(64))


def protected(response):
    assert response.headers['cache-control'] == 'no-store, private'
    assert response.headers['x-content-type-options'] == 'nosniff'
    assert response.headers['referrer-policy'] == 'no-referrer'


def upload(client, report_id, body=JPEG, name='photo.jpg', content_type='image/jpeg'):
    response = client.post(f'/api/v1/reports/{report_id}/attachments', headers=auth(REPORTER),
                           files={'file': (name, body, content_type)}, data={'consent': 'true'})
    assert response.status_code == 201, response.text
    return response.json()


def events(settings):
    with sqlite3.connect(settings.database_path) as database:
        return database.execute('SELECT event,clip_id FROM audit_events ORDER BY rowid').fetchall()


@pytest.fixture
def evidence(client, settings):
    report = submit(client)
    rid = report['report_id']
    image = upload(client, rid)
    audio = upload(client, rid, b'RIFF' + b'\x00' * 4 + b'WAVE' + b'\x00' * 32, 'voice.wav', 'audio/wav')
    video = upload(client, rid, VIDEO, 'clip.mp4', 'video/mp4')
    clip_id = 'c' * 32
    settings.clips_dir.mkdir()
    (settings.clips_dir / (clip_id + '.mp4')).write_bytes(VIDEO)
    client.app.state.store.save_clip({'clip_id': clip_id, 'report_id': rid, 'camera_id': 'cam-01',
        'start': '2026-10-22T01:00:00Z', 'created_at': VERSION, 'bytes': len(VIDEO),
        'sha256': hashlib.sha256(VIDEO).hexdigest(), 'download_path': f'/api/v1/admin/clips/{clip_id}/download'}, 'operator')
    cameras = []
    for kind in ('scan', 'focus', 'all'):
        path = settings.analysis_dir / rid / kind / 'cam-01' / 'evidence-01.jpg'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(JPEG)
        cameras.append({'camera_id': 'cam-01', kind: {'evidence': [{'file': path.name,
            'path': f'{kind}/cam-01/{path.name}', 'timestamp_seconds': 1.5}]}})
    phone = settings.analysis_dir / rid / 'phone' / image['attachment_id'] / 'evidence-01.jpg'
    phone.parent.mkdir(parents=True)
    phone.write_bytes(JPEG)
    analysis = {'started_at': VERSION, 'finished_at': VERSION, 'cameras': cameras, 'phone': [
        {'attachment_id': image['attachment_id'], 'kind': 'image', 'analysis': {'evidence': [
            {'file': phone.name, 'path': f'phone/{image["attachment_id"]}/{phone.name}', 'timestamp_seconds': 0}]}}]}
    client.app.state.store.save_analysis(rid, analysis)
    client.app.state.store.update_job(report['job']['id'], 'COMPLETED', 1, state='completed')
    return {'client': client, 'settings': settings, 'report': report, 'id': rid, 'image': image,
            'audio': audio, 'video': video, 'clip_id': clip_id, 'analysis': analysis}


def catalogue(evidence):
    response = evidence['client'].get(f'/api/v1/admin/reports/{evidence["id"]}/evidence', headers=auth(ADMIN))
    assert response.status_code == 200, response.text
    return response


def item_of(evidence, category, **fields):
    return next(item for item in catalogue(evidence).json()['items'] if item['category'] == category and
                all(item.get(key) == value for key, value in fields.items()))


def test_catalogue_includes_current_declared_evidence_all_categories_and_versions(evidence):
    root = evidence['settings'].analysis_dir / evidence['id']
    (root / 'focus/cam-01/evidence-02.jpg').write_bytes(JPEG)
    response = catalogue(evidence)
    protected(response)
    result = response.json()
    assert result['analysis_started_at'] == VERSION
    items = result['items']
    assert len(items) == 8
    assert {item['category'] for item in items} == {'attachment', 'artifact', 'clip'}
    assert {item['artifact_kind'] for item in items if item['category'] == 'artifact'} == {'scan', 'focus', 'all', 'phone'}
    for item in items:
        assert re.fullmatch('[0-9a-f]{64}', item['id'])
        assert item['available'] is True
        assert item['integrity'] == 'unknown' and item['current_sha256'] is None
        assert item['view_url'].startswith('/api/v1/') and item['download_url'].startswith('/api/v1/')
        assert item['representation'] in {'upload_original', 'remux_copy', 'analysis_overlay'}
        assert str(evidence['settings'].database_path.parent) not in str(item)
        if item['category'] == 'artifact':
            assert parse_qs(urlsplit(item['view_url']).query)['analysis_started_at'] == [VERSION]
            assert parse_qs(urlsplit(item['thumbnail_url']).query)['analysis_started_at'] == [VERSION]
        else:
            assert item['analysis_started_at'] is None
            if item['category'] == 'attachment':
                assert item['captured_at'] is None
    assert item_of(evidence, 'attachment', attachment_id=evidence['audio']['attachment_id'])['thumbnail_url'] is None


def test_catalogue_metadata_admin_only_and_item_report_membership(evidence):
    base = f'/api/v1/admin/reports/{evidence["id"]}/evidence'
    for path in (base, base + '/' + '0' * 64, base + '/' + '0' * 64 + '/thumbnail'):
        assert evidence['client'].get(path).status_code == 401
        assert evidence['client'].get(path, headers=auth(REPORTER)).status_code == 403
    assert evidence['client'].get('/api/v1/admin/reports/' + '0' * 32 + '/evidence', headers=auth(ADMIN)).status_code == 404
    other = submit(evidence['client'])['report_id']
    item = item_of(evidence, 'attachment', attachment_id=evidence['image']['attachment_id'])
    assert evidence['client'].get(f'/api/v1/admin/reports/{other}/evidence/{item["id"]}', headers=auth(ADMIN)).status_code == 404


def test_reporter_inline_attachment_preserves_ownership_and_distinct_audit(evidence):
    client = evidence['client']
    path = evidence['image']['download_path']
    assert client.get(path + '?disposition=inline', headers=auth(OTHER)).status_code == 404
    response = client.get(path + '?disposition=inline', headers=auth(REPORTER))
    assert response.status_code == 200 and response.content == JPEG
    assert response.headers['content-disposition'].startswith('inline;')
    protected(response)
    response = client.get(path, headers=auth(REPORTER))
    assert response.headers['content-disposition'].startswith('attachment;')
    assert 'evidence_view_requested' in [event for event, _ in events(evidence['settings'])]
    assert 'attachment_downloaded' in [event for event, _ in events(evidence['settings'])]


def test_info_verification_distinguishes_stored_current_hash_and_blocks_tamper(evidence):
    item = item_of(evidence, 'attachment', attachment_id=evidence['image']['attachment_id'])
    url = f'/api/v1/admin/reports/{evidence["id"]}/evidence/{item["id"]}'
    response = evidence['client'].get(url, params={'verify': 'true'}, headers=auth(ADMIN))
    assert response.status_code == 200
    assert response.json()['integrity'] == 'match'
    assert response.json()['current_sha256'] == hashlib.sha256(JPEG).hexdigest()
    path = evidence['settings'].attachments_dir / evidence['id'] / (evidence['image']['attachment_id'] + '.jpg')
    path.write_bytes(JPEG + b'changed')
    info = evidence['client'].get(url, params={'verify': 'true'}, headers=auth(ADMIN)).json()
    assert info['integrity'] == 'mismatch' and info['recorded_sha256'] != info['current_sha256']
    for key in ('view_url', 'download_url', 'thumbnail_url'):
        response = evidence['client'].get(item[key], headers=auth(ADMIN))
        assert response.status_code == 409
        protected(response)


@pytest.mark.parametrize('category', ['attachment', 'clip'])
def test_missing_original_is_unavailable_and_cannot_be_served(evidence, category):
    item = item_of(evidence, category, **({'attachment_id': evidence['image']['attachment_id']} if category == 'attachment' else {}))
    if category == 'attachment':
        path = evidence['settings'].attachments_dir / evidence['id'] / (evidence['image']['attachment_id'] + '.jpg')
    else:
        path = evidence['settings'].clips_dir / (evidence['clip_id'] + '.mp4')
    path.unlink()
    missing = next(row for row in catalogue(evidence).json()['items'] if row['id'] == item['id'])
    assert missing['available'] is False and missing['bytes'] is None and missing['thumbnail_url'] is None
    assert evidence['client'].get(item['view_url'], headers=auth(ADMIN)).status_code in (404, 409)


@pytest.mark.parametrize('state', ['queued', 'running'])
def test_pending_analysis_omits_artifacts_and_rejects_versioned_reads(evidence, state):
    item = item_of(evidence, 'artifact', artifact_kind='focus')
    evidence['client'].app.state.store.update_job(evidence['report']['job']['id'], 'SCANNING', .3, state=state)
    result = catalogue(evidence).json()
    assert not [row for row in result['items'] if row['category'] == 'artifact']
    assert result['warnings']
    for url in (item['view_url'], item['thumbnail_url'], f'/api/v1/admin/reports/{evidence["id"]}/evidence/{item["id"]}?analysis_started_at={VERSION}'):
        assert evidence['client'].get(url, headers=auth(ADMIN)).status_code == 409


def test_artifact_detail_requires_version_and_rejects_stale_version(evidence):
    item = item_of(evidence, 'artifact', artifact_kind='focus')
    base = f'/api/v1/admin/reports/{evidence["id"]}/evidence/{item["id"]}'
    for path in (base, base + '/thumbnail'):
        assert evidence['client'].get(path, headers=auth(ADMIN)).status_code == 422
        assert evidence['client'].get(path, params={'analysis_started_at': 'old'}, headers=auth(ADMIN)).status_code == 409
    response = evidence['client'].get(item['download_url'], headers=auth(ADMIN))
    assert response.status_code == 200 and response.content == JPEG
    assert response.headers['content-disposition'].startswith('attachment;')
    assert 'artifact_downloaded' in [event for event, _ in events(evidence['settings'])]


@pytest.mark.parametrize('disposition', ['broken', 'inline\r\nX-Evil: yes'])
def test_unrecognised_disposition_rejected_with_private_headers(evidence, disposition):
    response = evidence['client'].get(evidence['image']['download_path'], params={'disposition': disposition}, headers=auth(ADMIN))
    assert response.status_code == 422
    protected(response)


@pytest.mark.parametrize('category', ['attachment', 'clip'])
def test_video_ranges_if_range_head_and_audit(evidence, category):
    item = item_of(evidence, category, **({'attachment_id': evidence['video']['attachment_id']} if category == 'attachment' else {}))
    client = evidence['client']
    before = events(evidence['settings'])
    head = client.head(item['view_url'], headers=auth(ADMIN))
    assert head.status_code == 200 and head.content == b''
    assert int(head.headers['content-length']) == len(VIDEO)
    protected(head)
    assert events(evidence['settings']) == before
    for value, expected in [('bytes=0-9', VIDEO[:10]), ('bytes=10-', VIDEO[10:]), ('bytes=-10', VIDEO[-10:])]:
        response = client.get(item['view_url'], headers={**auth(ADMIN), 'Range': value})
        assert response.status_code == 206 and response.content == expected
        assert response.headers['content-range'].endswith('/' + str(len(VIDEO)))
        assert int(response.headers['content-length']) == len(expected)
        protected(response)
    match = client.get(item['view_url'], headers={**auth(ADMIN), 'Range': 'bytes=0-9', 'If-Range': head.headers['etag']})
    assert match.status_code == 206 and match.content == VIDEO[:10]
    stale = client.get(item['view_url'], headers={**auth(ADMIN), 'Range': 'bytes=0-9', 'If-Range': '"stale"'})
    assert stale.status_code == 200 and stale.content == VIDEO
    assert len(events(evidence['settings'])) - len(before) == 5
    for value, status in [('bytes=99999-', 416), ('bytes=oops', 400)]:
        response = client.get(item['view_url'], headers={**auth(ADMIN), 'Range': value})
        assert response.status_code == status
        protected(response)
    assert len(events(evidence['settings'])) - len(before) == 5


@pytest.mark.parametrize('name', ['..%2Fevidence-01.jpg', '..%5Cevidence-01.jpg', 'C:%5Csecret.jpg', 'evidence-04.jpg'])
def test_artifact_filename_and_membership_checked(evidence, name):
    path = f'/api/v1/admin/reports/{evidence["id"]}/artifacts/focus/cam-01/{name}'
    assert evidence['client'].get(path, headers=auth(ADMIN)).status_code in (404, 422)
    path = f'/api/v1/admin/reports/{evidence["id"]}/artifacts/focus/cam-01/evidence-02.jpg'
    (evidence['settings'].analysis_dir / evidence['id'] / 'focus/cam-01/evidence-02.jpg').write_bytes(JPEG)
    assert evidence['client'].get(path, headers=auth(ADMIN)).status_code == 404


def test_symlink_escape_never_served_or_exported(evidence, tmp_path):
    target = evidence['settings'].analysis_dir / evidence['id'] / 'focus/cam-01/evidence-01.jpg'
    outside = tmp_path / 'outside.jpg'
    outside.write_bytes(b'outside confidential content')
    target.unlink()
    try:
        target.symlink_to(outside)
    except OSError:
        pytest.skip('OS does not allow unprivileged symbolic links')
    item = item_of(evidence, 'artifact', artifact_kind='focus')
    assert evidence['client'].get(item['view_url'], headers=auth(ADMIN)).status_code in (404, 409)
    package = evidence['client'].get(f'/api/v1/admin/reports/{evidence["id"]}/package.zip', headers=auth(ADMIN))
    if package.status_code == 200:
        import zipfile
        archive = zipfile.ZipFile(io.BytesIO(package.content))
        assert b'outside confidential content' not in b''.join(archive.read(name) for name in archive.namelist())
    else:
        assert package.status_code in (404, 409)
