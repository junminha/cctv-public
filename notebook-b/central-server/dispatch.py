"""Simulated agency connection for the demo: recommend who to contact, record a mock send.

Nothing here opens a network connection or forwards media. Real 112/119/district links need formal
agreements first (design doc §0-9). The model may only pick from AGENCIES; a person presses send.
"""
AGENCIES = {
    'FIRE_119': ('119 종합상황실', '생명·신체 위험 의심, 구조·응급, 화재 의심 접수'),
    'FIRE_STATION': ('관할 소방서', '화재 의심 현장 확인, 위험 요소 점검'),
    'POLICE_112': ('112 치안종합상황실', '다툼·위협 의심, 교통 위험, 위험물 의심 접수'),
    'POLICE_STATION': ('{district} 관할 경찰서', '반복되는 안전 불편·순찰 요청'),
    'CITY_HALL': ('부산광역시청 담당 부서', '시 관리 공공시설물·대로·광역 시설 불편'),
    'DISTRICT_OFFICE': ('{district}청 민원 담당', '구·군 생활 불편 민원 접수'),
    'DISTRICT_ROAD': ('{district}청 도로 관리 부서', '도로·보도 파손, 포트홀, 침하'),
    'DISTRICT_CLEAN': ('{district}청 청소·환경 부서', '쓰레기 무단투기, 방치 폐기물, 청소'),
    'DISTRICT_PARKING': ('{district}청 주정차 단속 부서', '불법 주정차 의심, 통행 방해 차량'),
    'PUBLIC_HEALTH': ('{district} 보건소', '금연구역 흡연 의심 단속'),
    'CCTV_CENTER': ('{district} CCTV 통합관제센터', '공공 CCTV 영상 열람 요청'),
}
RULES = {
    'FALL_SUSPECTED': ['FIRE_119', 'CCTV_CENTER'],
    'VEHICLE_OBSTRUCTION': ['DISTRICT_PARKING', 'POLICE_112'],
    'ABANDONED_OBJECT': ['DISTRICT_CLEAN', 'POLICE_112'],
    'ILLEGAL_DUMPING': ['DISTRICT_CLEAN'],
    'SMOKING': ['PUBLIC_HEALTH'],
    'POTHOLE': ['DISTRICT_ROAD'],
    'VANDALISM': ['DISTRICT_OFFICE', 'CITY_HALL'],
    'FIRE_SMOKE': ['FIRE_119', 'FIRE_STATION'],
    'SAFETY_THREAT': ['POLICE_112', 'CCTV_CENTER'],
    'OTHER': ['DISTRICT_OFFICE'],
}
REASONS = {
    'FIRE_119': '생명·신체 위험이나 화재 의심은 확인되지 않았더라도 구조·응급 판단 기관이 먼저 알아야 합니다.',
    'FIRE_STATION': '화재·연기 의심 장소의 현장 확인과 위험 점검은 관할 소방서 업무입니다.',
    'POLICE_112': '다툼·위협 의심이나 통행 위험이 이어지면 현장 확인이 필요할 수 있습니다.',
    'POLICE_STATION': '반복되는 안전 불편은 관할 경찰서 순찰 요청으로 다룰 수 있습니다.',
    'CITY_HALL': '시가 관리하는 공공시설물·대로의 불편은 시청 담당 부서가 처리합니다.',
    'DISTRICT_OFFICE': '생활 불편 민원은 관할 구·군청에서 접수합니다.',
    'DISTRICT_ROAD': '도로·보도 파손 보수는 관할 구·군청 도로 관리 부서 업무입니다.',
    'DISTRICT_CLEAN': '무단투기·방치 폐기물 처리는 관할 구·군청 청소·환경 부서 업무입니다.',
    'DISTRICT_PARKING': '통행을 막는 주정차 단속은 관할 구·군청 주정차 단속 부서 업무입니다.',
    'PUBLIC_HEALTH': '금연구역 흡연 단속은 관할 보건소 업무입니다.',
    'CCTV_CENTER': '사건 장소 주변 공공 CCTV 영상은 관할 관제센터를 통해서만 열람할 수 있습니다.',
}
ALWAYS = {'FALL_SUSPECTED': 'FIRE_119', 'FIRE_SMOKE': 'FIRE_119'}


def district_of(analysis):
    ranked = ((analysis or {}).get('nearby') or {}).get('public', {}).get('recommended') or []
    return next((row['district'] for row in ranked if row.get('kind', 'public') == 'public' and row.get('district')),
                '관할 구·군')


def name_of(agency, district):
    return AGENCIES[agency][0].format(district=district)


def brief(report, analysis):
    """Facts the message may carry: incident, place and the analysis outcome. No media, no reporter identity."""
    analysis = analysis or {}
    incident = (analysis.get('classification') or {}).get('incident_type', 'OTHER')
    summary = analysis.get('summary') or {}
    from intelligence import INCIDENT_LABELS
    lines = [f"[모의] 시민 신고 #{report['report_id'][:6].upper()} · {INCIDENT_LABELS.get(incident, incident)}(확인 필요)",
             f"위치: 위도 {report['latitude']:.5f}, 경도 {report['longitude']:.5f}"
             + (f" · {report['details']}" if report.get('details') else ''),
             f"신고 내용: {report.get('description') or '(위치만 신고)'}"]
    best = (analysis.get('best_camera') or {}).get('video')
    if best:
        lines.append(f"CCTV 자동 탐지 후보: {best['camera_id']} · {best.get('reason', '')} (미확인)")
    if summary.get('unverified_facts'):
        lines.append('확인되지 않은 사항: ' + '; '.join(summary['unverified_facts'][:2]))
    return '\n'.join(lines)


def local_recommend(report, analysis):
    incident = ((analysis or {}).get('classification') or {}).get('incident_type', 'OTHER')
    district = district_of(analysis)
    text = brief(report, analysis)
    return {'agencies': [{'agency': agency, 'name': name_of(agency, district), 'reason': REASONS[agency], 'message': text}
                         for agency in RULES.get(incident, RULES['OTHER'])],
            'source': 'local_rules', 'warnings': [], 'district': district}


def finish(recommendation, report, analysis):
    """Enforce the fixed list and the life-risk rule on any recommendation, then fill names."""
    district = recommendation.get('district') or district_of(analysis)
    seen, rows = set(), []
    for row in recommendation['agencies']:
        if row['agency'] in AGENCIES and row['agency'] not in seen:
            seen.add(row['agency'])
            rows.append({**row, 'name': name_of(row['agency'], district)})
    incident = ((analysis or {}).get('classification') or {}).get('incident_type')
    must = ALWAYS.get(incident)
    if must and must not in seen:
        rows.insert(0, {'agency': must, 'name': name_of(must, district), 'reason': REASONS[must],
                        'message': brief(report, analysis)})
    return {**recommendation, 'agencies': rows[:3], 'district': district}
