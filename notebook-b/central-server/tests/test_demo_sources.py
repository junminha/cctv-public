import sqlite3

from test_server import ADMIN, auth, connected, locate, settings, submit, sync


def test_only_three_webcams_can_be_approved_and_selected(connected, settings):
    client, state = connected
    state['cameras'].append({'id': 'cam-04', 'name': 'Other CCTV', 'online': True, 'recording': True})
    assert sync(client).status_code == 200
    assert locate(client, 'cam-01').status_code == 200
    assert locate(client, 'cam-04').status_code == 403
    # An existing approval from an older DB must not bypass the demo-source restriction.
    with sqlite3.connect(settings.database_path) as database:
        database.execute("UPDATE cameras SET approved=1,latitude=37.5,longitude=127,kind='real' WHERE id='cam-04'")
    report = submit(client)
    candidates = client.get('/api/v1/admin/reports/' + report['report_id'] + '/candidates', headers=auth(ADMIN)).json()
    assert [camera['id'] for camera in candidates['cameras']] == ['cam-01']
    rows = client.get('/api/v1/admin/cameras', headers=auth(ADMIN)).json()['cameras']
    assert next(row for row in rows if row['id'] == 'cam-01')['demo_source'] is True
    assert next(row for row in rows if row['id'] == 'cam-04')['demo_source'] is False
