"""Report-radius CCTV guide and responder recommendations; data only, never actions.

nearby(report, incident_type, keywords, webcams) counts every CCTV inside the report radius:
approved A webcams (video AI candidates) and public Busan CCTV locations (metadata only).
Public CCTV is ranked from its location and published name alone; its video is never opened.

plan(report, result) turns the analysis result into ordered steps for the person on duty.
Life-risk reports always start with the 119 step whatever the models found. Nothing here
dispatches, calls or decides anything; the operator does.
"""
import math
import re

from intelligence import local_classification
from public_catalog import list_cameras

EARTH_M = 6371008.8
# Place hints read from the official facility name; a hint, not a verified purpose.
PLACES = (
    ('도로·교차로', ('교차로', '사거리', '삼거리', '오거리', '횡단보도', '도로', '터널', '교량', '대로', 'IC')),
    ('버스정류장', ('정류장', '정류소', '버스')),
    ('주차장', ('주차',)),
    ('학교·어린이보호', ('학교', '초등', '중학', '고교', '어린이', '유치원')),
    ('공원·산책로', ('공원', '놀이터', '산책로', '둘레길', '광장')),
    ('시장·상가', ('시장', '상가', '마트')),
    ('주거지 골목', ('골목', '빌라', '아파트', '주택', '맨션')),
)
FIT = {
    'FALL_SUSPECTED': {'버스정류장': 0.8, '공원·산책로': 0.8, '도로·교차로': 0.7, '주거지 골목': 0.7, '시장·상가': 0.7},
    'VEHICLE_OBSTRUCTION': {'도로·교차로': 1.0, '주차장': 1.0, '버스정류장': 0.7, '주거지 골목': 0.5},
    'ABANDONED_OBJECT': {'주거지 골목': 1.0, '공원·산책로': 0.8, '주차장': 0.8, '버스정류장': 0.6},
    'POTHOLE': {'도로·교차로': 1.0, '버스정류장': 0.6, '주차장': 0.5},
    'SMOKING': {'학교·어린이보호': 1.0, '공원·산책로': 0.9, '버스정류장': 0.9},
}
STOPWORDS = {'있어요', '있습니다', '같아요', '보여요', '주세요', '사람', '신고', '앞에', '근처', '여기', '지금'}


def distance_m(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return EARTH_M * 2 * math.asin(math.sqrt(min(1.0, max(0.0, a))))


def place_of(name):
    for label, words in PLACES:
        if any(word in name for word in words):
            return label
    return None


def terms(*texts):
    """Place words from the report: 2+ syllable tokens, also without a trailing particle."""
    found = set()
    for token in re.findall(r'[가-힣A-Za-z0-9]{2,}', ' '.join(t for t in texts if t)):
        if token in STOPWORDS:
            continue
        found.add(token)
        if len(token) >= 3 and token[-1] in '에의은는이가을를로과와도':
            found.add(token[:-1])
    return {term for term in found if len(term) >= 2 and term not in STOPWORDS}


def _public(report, incident, words):
    radius = report['radius_m']
    lat, lon = report['latitude'], report['longitude']
    dlat = radius / 111_320
    dlon = radius / (111_320 * max(0.01, math.cos(math.radians(lat))))
    catalog = list_cameras((lon - dlon, lat - dlat, lon + dlon, lat + dlat), limit=25000)
    sites, purposes, places = {}, {}, {}
    for camera in catalog['cameras']:
        distance = distance_m(lat, lon, camera['latitude'], camera['longitude'])
        if distance > radius:
            continue
        purposes[camera['purpose']] = purposes.get(camera['purpose'], 0) + 1
        site = sites.setdefault((camera['latitude'], camera['longitude']), {'devices': [], 'distance': distance})
        site['devices'].append(camera)
    ranked = []
    fit = FIT.get(incident, {})
    for (latitude, longitude), site in sites.items():
        names = [device['name'] for device in site['devices']]
        place = next((p for p in map(place_of, names) if p), None)
        places[place or '단서 없음'] = places.get(place or '단서 없음', 0) + 1
        compact = ' '.join(names).replace('_', '').replace(' ', '')
        matched = sorted(word for word in words if word in compact)
        proximity = max(0.0, 1 - site['distance'] / max(radius, 1))
        score = 0.55 * proximity + 0.30 * fit.get(place, 0.0) + 0.15 * (1.0 if matched else 0.0)
        reasons = [f"신고 지점에서 {round(site['distance'])}m"]
        if place:
            reasons.append(f'이름으로 본 장소: {place}' + (' (사건 유형과 맞음)' if fit.get(place) else ''))
        if matched:
            reasons.append('신고 내용의 지명과 일치: ' + ', '.join(matched[:3]))
        first = site['devices'][0]
        ranked.append({'id': first['id'], 'name': first['name'], 'district': first['district'],
                       'purpose': first['purpose'], 'latitude': latitude, 'longitude': longitude,
                       'distance_m': round(site['distance'], 1), 'device_count': len(names), 'place': place,
                       'score': round(score, 4), 'reasons': reasons})
    ranked.sort(key=lambda row: (-row['score'], row['distance_m'], row['id']))
    devices = sum(purposes.values())
    return {'devices': devices, 'sites': len(sites), 'purposes': purposes, 'places': places,
            'recommended': ranked[:5], 'source': catalog['source']['title'],
            'note': '공개 위치정보만 사용했습니다. 공공 CCTV 영상은 열람·분석하지 않습니다.'}


def nearby(report, incident_type, keywords, webcams):
    words = terms(report.get('description', ''), report.get('details', ''), *(keywords or []))
    return {
        'radius_m': report['radius_m'],
        'center': {'latitude': report['latitude'], 'longitude': report['longitude']},
        'location_kind': report['location_kind'],
        'webcams': {'total': len(webcams), 'cameras': [
            {'id': row['id'], 'name': row.get('name'), 'zone': row.get('zone'), 'latitude': row.get('latitude'),
             'longitude': row.get('longitude'), 'distance_m': row['distance_m']} for row in webcams]},
        'public': _public(report, incident_type, words),
    }


def best_camera(result):
    nearby_ = result.get('nearby') or {}
    selected = result.get('selected_camera_ids') or []
    rows = {row['camera_id']: row for row in result.get('cameras', [])}
    places = {row['id']: row for row in nearby_.get('webcams', {}).get('cameras', [])}
    video = None
    if selected:
        row = rows.get(selected[0], {})
        place = places.get(selected[0], {})
        found = [item['finding'] for item in (row.get('focus') or row.get('all') or {}).get('observations', [])]
        video = {'camera_id': selected[0], 'name': place.get('name'), 'zone': row.get('zone'),
                 'latitude': place.get('latitude'), 'longitude': place.get('longitude'),
                 'distance_m': row.get('distance_m'), 'event_score': row.get('event_score'),
                 'reason': '영상 분석에서 관련 장면 후보' + (f": {', '.join(found[:2])}" if found else '')}
    recommended = nearby_.get('public', {}).get('recommended') or []
    public = recommended[0] if recommended else None
    if video:
        note = '웹캠 영상에서 관련 장면 후보가 나온 카메라를 먼저 확인하세요.'
    elif public:
        note = '웹캠 영상에서 관련 장면을 찾지 못해 위치정보 기준 공공 CCTV를 안내합니다.'
    else:
        note = '반경 안에 안내할 CCTV가 없습니다.'
    return {'video': video, 'public': public, 'note': note}


def _office(district):
    return f'{district}청' if district else '관할 구·군청'


def plan(report, result):
    incident = (result.get('classification') or {}).get('incident_type', 'OTHER')
    outcome = result.get('outcome')
    best = result.get('best_camera') or best_camera(result)
    public = best.get('public')
    district = public['district'] if public else None
    office = _office(district)
    point = f"위도 {report['latitude']:.5f}, 경도 {report['longitude']:.5f}"
    steps, contacts = [], []

    def step(action, reason):
        steps.append({'action': action, 'reason': reason})

    priority = 'normal'
    if incident == 'FALL_SUSPECTED':
        priority = 'urgent'
        contacts.append('119')
        step('신고자에게 119 신고 여부를 확인하고, 하지 않았다면 바로 119에 신고하도록 안내하세요.',
             '생명·신체 위험 신고는 AI 결과와 관계없이 기존 신고 절차가 먼저입니다.')

    available = [row for row in result.get('cameras', []) if row.get('status') == 'available']
    if best.get('video'):
        video = best['video']
        step(f"{video['camera_id']} 근거 프레임과 원본 영상을 직접 확인하세요.",
             f"{video['reason']} (자동 탐지 후보, 미확인).")
    elif outcome == 'NO_CAMERA_IN_RANGE':
        step('검색 반경을 넓혀 다시 분석하거나 현장 확인을 요청하세요.',
             f"반경 {round(report['radius_m'])}m 안에 영상 분석이 가능한 웹캠이 없습니다.")
    elif outcome in ('CAMERA_UNAVAILABLE', 'RECORDING_UNAVAILABLE'):
        step('A 노트북 웹캠 연결·녹화 상태를 확인한 뒤 다시 분석하세요.', '분석할 영상을 받지 못했습니다.')
    elif outcome == 'MANUAL_REVIEW_REQUIRED':
        step('자동 분석이 실패했습니다. 반경 안 웹캠 원본 영상을 직접 확인하세요.', '분석 오류로 결과가 없습니다.')
    else:
        step('사건 장소가 웹캠 시야 밖일 수 있습니다. 신고자에게 상세 위치를 다시 확인하세요.',
             f'분석한 웹캠 {len(available)}대에서 관련 장면 후보를 찾지 못했습니다.')

    if incident == 'FALL_SUSPECTED':
        step(f'가까운 현장 인력에게 신고 위치({point})와 상세 위치를 전달하세요.',
             '쓰러짐 여부와 의식·호흡은 현장에서만 확인할 수 있습니다.')
    elif incident == 'VEHICLE_OBSTRUCTION':
        priority = 'high' if best.get('video') else priority
        contacts += [f'{office} 주정차 단속', '112(통행 위험 시)']
        step(f'{office} 주정차 단속 부서에 차량 위치({point})를 전달하세요. 통행·안전에 즉시 위험하면 112에 알리세요.',
             '영상만으로 불법 주정차를 판정하지 않습니다.')
    elif incident == 'ABANDONED_OBJECT':
        contacts += ['112(위험물 의심 시)', f'{office} 청소 담당']
        step(f'위험물로 의심되면 접근하지 말고 112에 알리세요. 일반 방치물이면 {office} 청소 담당에 전달하세요.',
             '모델이 학습하지 않은 물체는 탐지하지 못할 수 있습니다.')
    elif incident == 'POTHOLE':
        contacts.append(f'{office} 도로 관리 부서')
        step(f'{office} 도로 관리 부서에 보수 요청과 위치({point})를 전달하세요. 사고 위험이 크면 임시 안전 표시를 요청하세요.',
             '일반 객체 탐지 모델은 도로 파손을 직접 찾지 못해 사진·현장 확인이 필요합니다.')
    elif incident == 'SMOKING':
        contacts.append(f'{district or "관할"} 보건소 금연 단속')
        step(f'금연구역인지 확인한 뒤 {district or "관할"} 보건소 금연 단속에 전달하세요.',
             '영상만으로 흡연·규정 위반을 확정할 수 없습니다.')
    else:
        step('신고자에게 무엇이 문제인지 추가로 확인하세요.', '사건 유형을 특정하지 못했습니다.')

    if public:
        sites = (result.get('nearby') or {}).get('public', {}).get('sites', 0)
        step(f"공공 CCTV 영상이 필요하면 {public['district']} 관제센터에 정식 절차로 열람을 요청하세요. "
             f"반경 안 {sites}곳 중 가장 적합한 곳: {public['name']} ({round(public['distance_m'])}m, "
             f"위도 {public['latitude']:.5f}, 경도 {public['longitude']:.5f}).",
             '이 시스템은 공공 CCTV 영상에 접근하지 않고 위치정보만 씁니다.')
    if best.get('video'):
        step('사건 구간 영상을 보존하세요(사건 영상 보존).', '원본 녹화가 자동 삭제되기 전에 증거를 남깁니다.')
    summary = result.get('summary') or {}
    if str(summary.get('source', '')).startswith('openai:') and summary.get('recommended_next_step'):
        step(summary['recommended_next_step'], 'AI 요약 제안')

    cautions = ['추천은 참고용입니다. 출동·조치 결정은 담당자가 합니다.', *summary.get('unverified_facts', [])]
    if report.get('location_kind') == 'demo':
        cautions.append('시연 지점 기준 안내입니다. 공공 CCTV·관할 기관은 실제 사건 위치가 아닐 수 있습니다.')
    labels = {'urgent': '긴급', 'high': '높음', 'normal': '보통'}
    return {'priority': priority, 'priority_label': labels[priority], 'steps': steps,
            'contacts': list(dict.fromkeys(contacts)), 'cautions': list(dict.fromkeys(cautions)),
            'source': 'local_rules'}


def alert_state(detail):
    """Priority for the console: the analysed plan, or keyword rules right at intake."""
    analysis = detail.get('analysis') or {}
    plan = analysis.get('response_plan')
    if plan:
        priority, basis = plan['priority'], 'analysis'
    else:
        incident = ((analysis.get('classification') or {}).get('incident_type')
                    or local_classification(detail.get('description', ''), detail.get('details', ''))['incident_type'])
        priority, basis = ('urgent' if incident == 'FALL_SUSPECTED' else 'normal'), 'keywords'
    logs = [event for event in detail.get('events', []) if event['type'] == 'response_log']
    review = detail.get('review') or {}
    acknowledged = (any(event['data'].get('kind') == 'alert_ack' for event in logs)
                    or bool(review.get('confirmed_at') or review.get('closed_at')))
    return {'priority': priority, 'priority_basis': basis, 'alert_acknowledged': acknowledged,
            'response_logs': len(logs)}


HANDLING = {'received': '접수됨', 'analyzing': '분석 중', 'analyzed': '분석 완료 · 담당자 검토 대기',
            'responding': '담당자 대응 중', 'confirmed': '담당자 확인', 'closed': '종결'}


def handling(detail):
    """What a citizen may know about handling: stages and times only, no names, notes or actions."""
    events = detail.get('events', [])
    review = detail.get('review') or {}

    def first(kind):
        return next((event['created_at'] for event in events if event['type'] == kind), None)
    moments = [('received', detail['created_at']), ('analyzing', first('analysis_requested')),
               ('analyzed', first('analysis_finished')), ('responding', first('response_log')),
               ('confirmed', review.get('confirmed_at')), ('closed', review.get('closed_at'))]
    timeline = [{'state': state, 'label': HANDLING[state], 'at': at} for state, at in moments if at]
    state = timeline[-1]['state']
    job = detail['job']
    if job['state'] in ('queued', 'running') and job.get('params') is not None and state in ('received', 'analyzed'):
        state = 'analyzing'
    return {'state': state, 'label': HANDLING[state], 'timeline': timeline}
