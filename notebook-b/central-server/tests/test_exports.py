import csv
import hashlib
import io
import json
import sqlite3
from types import SimpleNamespace
import zipfile

import pytest
from fastapi.testclient import TestClient

from app import create_app
from test_server import ADMIN, REPORTER, TOKENS, auth, submit

JPEG = b'\xff\xd8\xff\xe0' + b'jpeg-body' * 20
CSV_URL = '/api/v1/admin/exports/reports.csv'


@pytest.fixture
def settings(tmp_path):
    return SimpleNamespace(database_path=tmp_path / 'central.sqlite3', tokens=TOKENS, adapter_url='',
                           adapter_token='', attachments_dir=tmp_path / 'attachments',
                           analysis_dir=tmp_path / 'analysis', clips_dir=tmp_path / 'clips')


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as instance:
        yield instance


def audit(settings):
    with sqlite3.connect(settings.database_path) as database:
        return [row[0] for row in database.execute('SELECT event FROM audit_events ORDER BY rowid')]


def rows(response):
    assert response.content.startswith('﻿'.encode('utf-8'))
    return list(csv.reader(io.StringIO(response.content.decode('utf-8-sig'))))


def test_csv_is_admin_only_excel_safe_and_audited(client, settings):
    first = submit(client, description='=HYPERLINK("http://evil")')
    submit(client, ADMIN, location_kind='demo')
    assert client.get(CSV_URL, headers=auth(REPORTER)).status_code == 403
    response = client.get(CSV_URL, headers=auth(ADMIN))
    assert response.status_code == 200
    assert response.headers['content-type'].startswith('text/csv')
    assert 'attachment; filename="reports-' in response.headers['content-disposition']
    table = rows(response)
    assert table[0][:3] == ['신고 ID', '접수 시각(KST)', '출처']
    assert len(table) == 3
    record = dict(zip(table[0], table[1]))
    assert record['신고 ID'] == first['report_id']
    # Formula-looking citizen text is neutralised, KST conversion applies to occurred_at.
    assert record['신고 내용'] == '\'=HYPERLINK("http://evil")'
    assert record['발생 시각(KST)'] == '2026-10-22 10:00:00'
    assert record['분석 상태'] == 'queued'
    assert audit(settings).count('reports_csv_exported') == 1


def test_csv_filters_by_intake_time(client):
    submit(client)
    assert len(rows(client.get(CSV_URL, params={'end': '2000-01-01T00:00:00Z'}, headers=auth(ADMIN)))) == 1
    assert len(rows(client.get(CSV_URL, params={'start': '2000-01-01T00:00:00Z'}, headers=auth(ADMIN)))) == 2
    bad = client.get(CSV_URL, params={'start': '2026-01-02T00:00:00Z', 'end': '2026-01-01T00:00:00Z'},
                     headers=auth(ADMIN))
    assert bad.status_code == 422


def test_package_bundles_hashed_evidence_and_flags_tampering(client, settings):
    report_id = submit(client)['report_id']
    url = f'/api/v1/reports/{report_id}/attachments'
    uploaded = client.post(url, headers=auth(REPORTER), files={'file': ('a.jpg', JPEG, 'image/jpeg')},
                           data={'consent': 'true'}).json()
    frame = settings.analysis_dir / report_id / 'focus' / 'cam-01' / 'evidence-01.jpg'
    frame.parent.mkdir(parents=True)
    frame.write_bytes(JPEG)
    package = f'/api/v1/admin/reports/{report_id}/package.zip'
    assert client.get(package, headers=auth(REPORTER)).status_code == 403
    assert client.get('/api/v1/admin/reports/' + '0' * 32 + '/package.zip', headers=auth(ADMIN)).status_code == 404

    response = client.get(package, headers=auth(ADMIN))
    assert response.status_code == 200
    assert response.headers['content-type'] == 'application/zip'
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    names = set(archive.namelist())
    stored = 'attachments/' + uploaded['attachment_id'] + '.jpg'
    assert {'report.json', 'clips.json', 'audit.json', 'manifest.json', stored,
            'analysis/focus/cam-01/evidence-01.jpg'} <= names
    manifest = json.loads(archive.read('manifest.json'))
    for entry in manifest['files']:
        assert hashlib.sha256(archive.read(entry['path'])).hexdigest() == entry['sha256']
    assert next(row for row in manifest['files'] if row['path'] == stored)['matches_recorded_sha256'] is True
    assert json.loads(archive.read('report.json'))['report_id'] == report_id
    assert 'report_package_exported' in [row['event'] for row in json.loads(archive.read('audit.json'))]
    assert list((settings.database_path.parent / 'exports').iterdir()) == []

    (settings.attachments_dir / report_id / (uploaded['attachment_id'] + '.jpg')).write_bytes(JPEG + b'x')
    manifest = json.loads(zipfile.ZipFile(io.BytesIO(client.get(package, headers=auth(ADMIN)).content))
                          .read('manifest.json'))
    assert next(row for row in manifest['files'] if row['path'] == stored)['matches_recorded_sha256'] is False

    lean = zipfile.ZipFile(io.BytesIO(client.get(package, params={'media': 'false'}, headers=auth(ADMIN)).content))
    assert set(lean.namelist()) == {'report.json', 'clips.json', 'audit.json', 'manifest.json'}
    assert audit(settings).count('report_package_exported') == 3
