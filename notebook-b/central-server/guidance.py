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
    'ILLEGAL_DUMPING': {'주거지 골목': 1.0, '공원·산책로': 0.8, '주차장': 0.7, '시장·상가': 0.7},
    'VANDALISM': {'공원·산책로': 1.0, '버스정류장': 0.9, '도로·교차로': 0.7, '학교·어린이보호': 0.7},
    'FIRE_SMOKE': {'시장·상가': 0.9, '주거지 골목': 0.8, '공원·산책로': 0.7},
    'SAFETY_THREAT': {'시장·상가': 0.9, '버스정류장': 0.8, '공원·산책로': 0.8, '주거지 골목': 0.8},
}
# Checked first whatever the models found; a triage order, not a finding.
URGENT = {'FALL_SUSPECTED': ('119', '생명·신체 위험 의심 신고는 AI 결과와 관계없이 기존 신고 절차가 먼저입니다.'),
          'FIRE_SMOKE': ('119', '화재·연기 의심 신고는 AI 결과와 관계없이 기존 신고 절차가 먼저입니다(화재 여부는 현장 확인).')}
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


def _public(report, incident, words, webcams=()):
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

    def score_of(distance, place, text):
        compact = text.replace('_', '').replace(' ', '')
        matched = sorted(word for word in words if word in compact)
        proximity = max(0.0, 1 - distance / max(radius, 1))
        score = 0.55 * proximity + 0.30 * fit.get(place, 0.0) + 0.15 * (1.0 if matched else 0.0)
        reasons = [f"신고 지점에서 {round(distance)}m"]
        if place:
            reasons.append(f'이름으로 본 장소: {place}' + (' (사건 유형과 맞음)' if fit.get(place) else ''))
        if matched:
            reasons.append('신고 내용의 지명과 일치: ' + ', '.join(matched[:3]))
        return round(score, 4), reasons

    for (latitude, longitude), site in sites.items():
        names = [device['name'] for device in site['devices']]
        place = next((p for p in map(place_of, names) if p), None)
        places[place or '단서 없음'] = places.get(place or '단서 없음', 0) + 1
        score, reasons = score_of(site['distance'], place, ' '.join(names))
        first = site['devices'][0]
        ranked.append({'kind': 'public', 'id': first['id'], 'name': first['name'], 'district': first['district'],
                       'purpose': first['purpose'], 'latitude': latitude, 'longitude': longitude,
                       'distance_m': round(site['distance'], 1), 'device_count': len(names), 'place': place,
                       'score': score, 'reasons': reasons})
    # Approved demo webcams compete on the same terms (user decision 2026-11-03); they alone also get video AI.
    placed = [row for row in webcams if row.get('latitude') is not None and row.get('longitude') is not None]
    for row in placed:
        name = row.get('name') or row['id']
        text = f"{name} {row.get('zone') or ''}"
        place = place_of(text)
        places[place or '단서 없음'] = places.get(place or '단서 없음', 0) + 1
        score, reasons = score_of(row['distance_m'], place, text)
        ranked.append({'kind': 'webcam', 'id': row['id'], 'name': name, 'district': None, 'purpose': '시연 웹캠',
                       'latitude': row['latitude'], 'longitude': row['longitude'], 'distance_m': round(row['distance_m'], 1),
                       'device_count': 1, 'place': place, 'score': score,
                       'reasons': [*reasons, '영상 분석 가능(시연 웹캠)']})
    if placed:
        purposes['시연 웹캠'] = len(placed)
    ranked.sort(key=lambda row: (-row['score'], row['distance_m'], row['id']))
    devices = sum(purposes.values())
    return {'devices': devices, 'sites': len(sites) + len(placed), 'webcams': len(placed), 'purposes': purposes,
            'places': places, 'recommended': ranked[:5], 'source': catalog['source']['title'],
            'note': '공개 CCTV는 위치정보만 사용하며 영상은 열람·분석하지 않습니다. 시연 웹캠은 같은 기준으로 순위에 넣고 영상도 분석합니다.'}


def nearby(report, incident_type, keywords, webcams):
    words = terms(report.get('description', ''), report.get('details', ''), *(keywords or []))
    return {
        'radius_m': report['radius_m'],
        'center': {'latitude': report['latitude'], 'longitude': report['longitude']},
        'location_kind': report['location_kind'],
        'webcams': {'total': len(webcams), 'cameras': [
            {'id': row['id'], 'name': row.get('name'), 'zone': row.get('zone'), 'latitude': row.get('latitude'),
             'longitude': row.get('longitude'), 'distance_m': row['distance_m']} for row in webcams]},
        'public': _public(report, incident_type, words, webcams),
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
        note = ('관련 장면은 찾지 못했습니다. 위치 기준 1위인 시연 웹캠을 확인하세요.' if public.get('kind') == 'webcam'
                else '웹캠 영상에서 관련 장면을 찾지 못해 위치정보 기준 공공 CCTV를 안내합니다.')
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
    ranked = (result.get('nearby') or {}).get('public', {}).get('recommended') or []
    # The responsible office comes from the first public CCTV in the ranking (webcams have no district).
    district = next((row['district'] for row in ranked if row.get('kind', 'public') == 'public' and row.get('district')),
                    public.get('district') if public else None)
    office = _office(district)
    point = f"위도 {report['latitude']:.5f}, 경도 {report['longitude']:.5f}"
    search = result.get('search') or {}
    steps, contacts = [], []

    def step(action, reason):
        steps.append({'action': action, 'reason': reason})

    priority = 'normal'
    if incident in URGENT:
        priority = 'urgent'
        number, reason = URGENT[incident]
        contacts.append(number)
        step(f'신고자에게 {number} 신고 여부를 확인하고, 하지 않았다면 바로 {number}에 신고하도록 안내하세요.', reason)

    available = [row for row in result.get('cameras', []) if row.get('status') == 'available']
    if best.get('video'):
        video = best['video']
        step(f"{video['camera_id']} 근거 프레임과 원본 영상을 직접 확인하세요.",
             f"{video['reason']} (자동 탐지 후보, 미확인).")
    elif outcome == 'NO_CAMERA_IN_RANGE':
        base = search.get('base_radius_m', report['radius_m'])
        widest = search.get('radius_m', report['radius_m'])
        within = (f"반경 {round(base)}m에서 {round(widest)}m까지 넓혀도" if widest > base
                  else f"반경 {round(widest)}m 안에")
        step('검색 반경을 넓혀 다시 분석하거나 현장 확인을 요청하세요.',
             f'{within} 영상 분석이 가능한 웹캠이 없습니다.')
    elif outcome in ('CAMERA_UNAVAILABLE', 'RECORDING_UNAVAILABLE'):
        step('녹화 장비의 웹캠 연결·녹화 상태를 확인한 뒤 다시 분석하세요.', '분석할 영상을 받지 못했습니다.')
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
    elif incident == 'ILLEGAL_DUMPING':
        contacts.append(f'{office} 청소·환경 부서')
        step(f'{office} 청소·환경 부서에 위치({point})와 장면 시각을 전달해 수거·확인을 요청하세요.',
             '영상만으로 투기 행위자나 위법 여부를 확정하지 않습니다.')
    elif incident == 'VANDALISM':
        contacts += [f'{office} 민원 담당', '부산광역시청 담당 부서(시 관리 시설인 경우)']
        step(f'파손된 시설의 관리 주체를 확인해 {office} 또는 시청 담당 부서에 보수를 요청하세요. 위험하면 접근 금지 안내를 요청하세요.',
             '파손 원인과 고의 여부는 영상만으로 판단하지 않습니다.')
    elif incident == 'FIRE_SMOKE':
        contacts.append('관할 소방서')
        step(f'웹캠 영상에서 연기·불꽃이 계속 보이는지 확인하고, 현장 인력에게 위치({point})를 전달하세요.',
             '연기는 조리·증기 등일 수 있어 현장 확인이 필요합니다.')
    elif incident == 'SAFETY_THREAT':
        priority = 'high'
        contacts.append('112(위협이 이어지는 것으로 보일 때)')
        step('웹캠 영상으로 상황이 이어지는지 확인하고, 위협이 계속되는 것으로 보이면 신고자에게 112 신고 여부를 확인하세요.',
             '다툼·위협 여부와 가해·피해는 영상만으로 판단하지 않습니다.')
    else:
        step('신고자에게 무엇이 문제인지 추가로 확인하세요.', '사건 유형을 특정하지 못했습니다.')

    sites = (result.get('nearby') or {}).get('public', {}).get('sites', 0)
    if public and public.get('kind') == 'webcam':
        if not best.get('video'):
            step(f"반경 안 {sites}곳 중 가장 적합한 CCTV는 {public['name']}({public['id']}, 시연 웹캠, {round(public['distance_m'])}m)입니다. "
                 '이 웹캠의 실시간·녹화 영상과 근거 프레임을 직접 확인하세요.',
                 '시연 웹캠은 이 시스템이 영상을 직접 받아 분석합니다.')
    elif public:
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
    if search.get('expanded'):
        cautions.append(f"신고 반경 {round(search['base_radius_m'])}m 안에 웹캠이 없어 {round(search['radius_m'])}m까지 자동 확대해 검색했습니다. "
                        '사건 장소와 떨어져 있을 수 있습니다.')
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
        priority, basis = ('urgent' if incident in URGENT else 'normal'), 'keywords'
    logs = [event for event in detail.get('events', []) if event['type'] == 'response_log']
    review = detail.get('review') or {}
    acknowledged = (any(event['data'].get('kind') == 'alert_ack' for event in logs)
                    or bool(review.get('confirmed_at') or review.get('closed_at')))
    return {'priority': priority, 'priority_basis': basis, 'alert_acknowledged': acknowledged,
            'response_logs': len(logs),
            'dispatches': sum(event['type'] == 'dispatch_simulated' for event in detail.get('events', []))}


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
