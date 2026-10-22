from test_server import ADMIN, REPORTER, auth, client, settings


def test_public_locations_are_paginated_separate_and_admin_only(client):
    url = '/api/v1/admin/public-cameras'
    assert client.get(url).status_code == 401
    assert client.get(url, headers=auth(REPORTER)).status_code == 403
    response = client.get(url, headers=auth(ADMIN), params={'limit': 2})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body['total'] > 20000
    assert len(body['cameras']) == 2
    assert body['source']['url'] == 'https://www.data.go.kr/data/15082060/fileData.do'
    assert all(row['metadata_only'] and not row['analysis_available'] for row in body['cameras'])
    assert client.get('/api/v1/admin/cameras', headers=auth(ADMIN)).json()['cameras'] == []
    second = client.get(url, headers=auth(ADMIN), params={'limit': 1, 'offset': 1}).json()
    assert second['cameras'][0]['id'] == body['cameras'][1]['id']
    empty = client.get(url, headers=auth(ADMIN), params={'west': 0, 'south': 0, 'east': 1, 'north': 1})
    assert empty.json()['total'] == 0
    for query in ({'west': 129}, {'west': 130, 'south': 35, 'east': 129, 'north': 36}, {'limit': 1001}):
        assert client.get(url, headers=auth(ADMIN), params=query).status_code == 422
