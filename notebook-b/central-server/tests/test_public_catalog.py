import csv
import hashlib
import importlib
import io
import json
import math

import pytest


def catalog_module():
    # A missing catalogue is an explicit test failure before implementation.
    assert importlib.util.find_spec('public_catalog'), 'public catalogue is not implemented'
    return importlib.import_module('public_catalog')


def test_official_snapshot_is_metadata_only_and_paginates_without_aliasing():
    catalog = catalog_module()
    first = catalog.list_cameras(limit=2)
    second = catalog.list_cameras(limit=1, offset=1)
    assert first['total'] > 20000
    assert second['cameras'][0] == first['cameras'][1]
    assert first['source']['quality']['invalid_coordinates'] == 49
    all_rows = catalog.list_cameras(limit=25000)['cameras']
    assert len(all_rows) == first['total']
    assert len({row['id'] for row in all_rows}) == len(all_rows)
    assert all(row['metadata_only'] and not row['analysis_available'] for row in all_rows)
    assert all(math.isfinite(row['latitude']) and math.isfinite(row['longitude']) for row in all_rows)
    assert all('stream_url' not in row for row in all_rows)
    first['cameras'][0]['analysis_available'] = True
    first['source']['quality']['invalid_coordinates'] = 0
    again = catalog.list_cameras(limit=1)
    assert again['cameras'][0]['analysis_available'] is False
    assert again['source']['quality']['invalid_coordinates'] == 49


def test_archived_official_bytes_reproduce_catalog_and_provenance():
    catalog = catalog_module()
    receipt = json.loads((catalog.DATA_DIR / 'source-manifest.json').read_text(encoding='utf-8'))
    raw = catalog.RAW_PATH.read_bytes()
    normalized = catalog.CATALOG_PATH.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == receipt['raw_sha256']
    assert hashlib.sha256(normalized).hexdigest() == receipt['normalized_sha256']
    snapshot = json.loads(normalized)
    assert catalog.build_catalog(raw, receipt['retrieved_at']) == snapshot
    counts = snapshot['source']['quality']
    assert counts['source_rows'] == (counts['valid_device_records']
                                    + len(snapshot['excluded'])
                                    + counts['duplicate_records_removed'])
    assert len(counts['district_counts']) == 16


def test_bounds_use_longitude_latitude_and_filter_before_pagination():
    catalog = catalog_module()
    result = catalog.list_cameras(bounds=(129.035121, 35.110905, 129.035121, 35.110905), limit=2)
    assert result['total'] >= 5
    assert len(result['cameras']) == 2
    assert all(row['latitude'] == 35.110905 and row['longitude'] == 129.035121
               for row in result['cameras'])
    assert catalog.list_cameras(bounds=(0, 0, 1, 1))['total'] == 0


@pytest.mark.parametrize('kwargs', [
    {'limit': -1}, {'limit': 25001}, {'limit': True}, {'offset': -1},
    {'bounds': (130, 35, 129, 36)}, {'bounds': (128, float('nan'), 129, 36)},
    {'bounds': (128, 35, 129)}, {'bounds': (-181, 35, 129, 36)},
])
def test_invalid_queries_fail_explicitly(kwargs):
    with pytest.raises(ValueError):
        catalog_module().list_cameras(**kwargs)


def test_normalization_rejects_bad_coordinates_and_retains_conflicting_source_ids():
    catalog = catalog_module()
    text = io.StringIO(newline='')
    writer = csv.writer(text)
    writer.writerow(['연번', '구군', '장비종류', '관리번호', '시설명칭', '위도', '경도'])
    rows = [
        ['1', '중구', '생활방범', 'same', 'first', '35.1', '129.1'],
        ['2', '중구', '생활방범', 'same', 'second', '35.2', '129.2'],
        ['3', '중구', '생활방범', 'bad', 'swapped', '129.1', '35.1'],
        ['4', '중구', '생활방범', 'missing', 'empty', '', '129.1'],
        ['5', '중구', '생활방범', 'outside', 'outside', '37.5', '127.0'],
        ['6', '중구', '생활방범', 'nan', 'nonfinite', 'nan', '129.1'],
        ['7', '서울', '생활방범', 'other', 'other', '35.1', '129.1'],
    ]
    writer.writerows(rows + [rows[0]])
    raw = text.getvalue().encode('cp949')
    result = catalog.build_catalog(raw, '2026-10-22T00:00:00Z')
    assert len(result['cameras']) == 2
    assert len({row['id'] for row in result['cameras']}) == 2
    assert {row['source_id'] for row in result['cameras']} == {'same'}
    assert result['source']['quality']['invalid_coordinates'] == 2
    assert result['source']['quality']['missing_coordinates'] == 1
    assert result['source']['quality']['outside_busan_envelope'] == 1
    assert result['source']['quality']['outside_busan_districts'] == 1
    assert result['source']['quality']['duplicate_records_removed'] == 1
    assert result['source']['quality']['duplicate_source_id_groups'] == 1
    assert len(result['excluded']) == 5
    assert result['cameras'] == catalog.build_catalog(raw, 'different retrieval')['cameras']
