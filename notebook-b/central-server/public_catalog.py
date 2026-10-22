"""Official Busan CCTV location metadata; never an approved video source.

list_cameras(bounds=None, limit=100, offset=0) returns {cameras, total, source}.
Bounds are inclusive (min_longitude, min_latitude, max_longitude, max_latitude).
The total is after bounds filtering and before pagination; limit is 0..25000.
Rebuild the checked-in snapshot: python public_catalog.py --rebuild
"""
import argparse
from collections import Counter
from copy import deepcopy
import csv
from functools import lru_cache
import hashlib
import io
import json
import math
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / 'data'
CATALOG_PATH = DATA_DIR / 'public-cctv-busan.json'
RAW_PATH = DATA_DIR / 'busan-cctv-source.csv'
SOURCE_URL = 'https://www.data.go.kr/data/15082060/fileData.do'
DOWNLOAD_URL = ('https://www.data.go.kr/cmm/cmm/fileDownload.do?'
                'atchFileId=FILE_000000003578112&fileDetailSn=1&insertDataPrcus=N')
DISTRICTS = set('중구 서구 동구 영도구 부산진구 동래구 남구 북구 해운대구 사하구 금정구 강서구 연제구 수영구 사상구 기장군'.split())
HEADERS = ['연번', '구군', '장비종류', '관리번호', '시설명칭', '위도', '경도']


def build_catalog(raw: bytes, retrieved_at: str) -> dict:
    """Normalize the pinned CP949 schema without geocoding or axis correction."""
    reader = csv.DictReader(io.StringIO(raw.decode('cp949'), newline=''))
    if reader.fieldnames != HEADERS:
        raise ValueError('Unexpected official Busan CCTV CSV schema')
    quality = dict.fromkeys([
        'source_rows', 'missing_coordinates', 'invalid_coordinates',
        'outside_busan_envelope', 'outside_busan_districts',
        'missing_source_ids', 'duplicate_records_removed',
    ], 0)
    cameras, excluded, seen = [], [], set()
    for raw_row in reader:
        quality['source_rows'] += 1
        row = {key: (value or '').strip() for key, value in raw_row.items()}
        # Serial number is an export position, not device identity.
        key = tuple(row[name] for name in HEADERS[1:])
        if key in seen:
            quality['duplicate_records_removed'] += 1
            continue
        seen.add(key)
        reason = None
        latitude = longitude = None
        if row['구군'] not in DISTRICTS:
            reason = 'outside_busan_districts'
        elif not row['관리번호']:
            reason = 'missing_source_ids'
        elif not row['위도'] or not row['경도']:
            reason = 'missing_coordinates'
        else:
            try:
                latitude, longitude = float(row['위도']), float(row['경도'])
                if not (math.isfinite(latitude) and math.isfinite(longitude)
                        and -90 <= latitude <= 90 and -180 <= longitude <= 180):
                    reason = 'invalid_coordinates'
                elif not (34.8 <= latitude <= 35.5 and 128.7 <= longitude <= 129.4):
                    reason = 'outside_busan_envelope'
            except ValueError:
                reason = 'invalid_coordinates'
        if reason:
            quality[reason] += 1
            excluded.append({'reason': reason, 'source_record': row})
            continue
        cameras.append({
            'id': 'public-busan-' + row['관리번호'],
            'source_id': row['관리번호'], 'source_row': row['연번'],
            'name': row['시설명칭'], 'district': row['구군'],
            'purpose': row['장비종류'], 'latitude': latitude, 'longitude': longitude,
            'metadata_only': True, 'analysis_available': False,
        })
    ids = Counter(camera['source_id'] for camera in cameras)
    for camera in cameras:
        if ids[camera['source_id']] > 1:
            identity = [camera[k] for k in ('source_id', 'district', 'name', 'purpose', 'latitude', 'longitude')]
            suffix = hashlib.sha256(json.dumps(identity, ensure_ascii=False).encode()).hexdigest()[:16]
            camera['id'] += '-' + suffix
    if len({camera['id'] for camera in cameras}) != len(cameras):
        raise ValueError('Normalized source identifiers are not unique')
    quality.update({
        'valid_device_records': len(cameras),
        'duplicate_source_id_groups': sum(count > 1 for count in ids.values()),
        'duplicate_source_id_extra_records': sum(count - 1 for count in ids.values()),
        'distinct_coordinate_pairs': len({(c['latitude'], c['longitude']) for c in cameras}),
        'district_counts': dict(sorted(Counter(c['district'] for c in cameras).items())),
    })
    source = {
        'id': 'data-go-kr-15082060', 'title': '부산광역시_방범용 CCTV 정보_20251229',
        'provider': '부산광역시', 'url': SOURCE_URL, 'download_url': DOWNLOAD_URL,
        'source_date': '2025-12-29', 'source_date_kind': 'portal_dataset_title',
        'portal_modified_date': '2026-01-07', 'record_reference_date': None,
        'retrieved_at': retrieved_at, 'raw_sha256': hashlib.sha256(raw).hexdigest(),
        'raw_bytes': len(raw), 'raw_encoding': 'cp949',
        'license': '이용허락범위 제한 없음',
        'grain': 'managed_device_record', 'camera_count_field': None,
        'installation_site_count': None, 'coordinate_system': 'published latitude/longitude',
        'coordinate_validation': {
            'finite_wgs84_ranges': True,
            'busan_envelope': [128.7, 34.8, 129.4, 35.5],
            'municipal_polygon_validation': False, 'axis_correction': False,
        },
        'metadata_only': True, 'analysis_available': False, 'quality': quality,
        'limitations': [
            '공개 위치정보이며 영상 접근권한·현재 작동·촬영범위를 확인하지 않습니다.',
            '개별 장비 행입니다. 같은 좌표의 장비를 중복 설치지점으로 집계하지 마세요.',
            '고유 좌표 수는 확인된 설치지점 수가 아닙니다. 주소·운영기관 필드는 제공되지 않습니다.',
            '원자료에 행별 기준일이 없습니다. 제목 일자와 다운로드 파일명 일자는 다릅니다.',
            '부산 구군명과 넓은 좌표 범위를 검사했으며 행정경계 폴리곤 검사는 하지 않았습니다.',
        ],
        'preferred_source_unavailable': {
            'url': 'https://file.localdata.go.kr/file/cctv_info/info',
            'result': '2026-10-22 HTTP 302 /error.html then HTTP 403; used official Busan fallback',
        },
    }
    return {'source': source, 'cameras': cameras, 'excluded': excluded}


@lru_cache(maxsize=1)
def _load():
    return json.loads(CATALOG_PATH.read_text(encoding='utf-8'))


def list_cameras(bounds=None, limit=100, offset=0) -> dict:
    """Query public locations only. Copies prevent callers mutating approval flags."""
    if type(limit) is not int or not 0 <= limit <= 25000:
        raise ValueError('limit must be an integer from 0 to 25000')
    if type(offset) is not int or offset < 0:
        raise ValueError('offset must be a nonnegative integer')
    if bounds is not None:
        try:
            west, south, east, north = bounds
            valid = all(type(v) in (float, int) and math.isfinite(v) for v in bounds)
            valid = valid and -180 <= west <= east <= 180 and -90 <= south <= north <= 90
        except (TypeError, ValueError):
            valid = False
        if not valid:
            raise ValueError('bounds must be finite min_lon,min_lat,max_lon,max_lat')
    data = _load()
    cameras = data['cameras']
    if bounds is not None:
        cameras = [c for c in cameras if west <= c['longitude'] <= east and south <= c['latitude'] <= north]
    return {'cameras': deepcopy(cameras[offset:offset + limit]), 'total': len(cameras),
            'source': deepcopy(data['source'])}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rebuild', action='store_true')
    args = parser.parse_args()
    if args.rebuild:
        # Preserve the actual retrieval receipt when reproducing the same bytes.
        receipt = json.loads((DATA_DIR / 'source-manifest.json').read_text(encoding='utf-8'))
        raw = RAW_PATH.read_bytes()
        if hashlib.sha256(raw).hexdigest() != receipt['raw_sha256']:
            raise ValueError('Raw snapshot differs from source retrieval receipt')
        result = build_catalog(raw, receipt['retrieved_at'])
        CATALOG_PATH.write_bytes((json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8'))
        print(json.dumps(result['source']['quality'], ensure_ascii=False))
    else:
        print(json.dumps(list_cameras(limit=0), ensure_ascii=False))
