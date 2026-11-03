"""Simulated agency connection for the demo: recommend who to contact, record a mock send.

Nothing here opens a network connection or forwards media. Real 112/119/district links need formal
agreements first (design doc §0-9). The model may only pick from AGENCIES; a person presses send.
"""
AGENCIES = {
    'FIRE_119': ('119 종합상황실', '생명·신체 위험, 구조·응급'),
    'POLICE_112': ('112 치안종합상황실', '범죄·안전 위협, 교통 위험'),
    'DISTRICT_OFFICE': ('{district}청 담당 부서', '주정차 단속, 도로 보수, 방치물·청소'),
    'PUBLIC_HEALTH': ('{district} 보건소', '금연구역 단속'),
    'CCTV_CENTER': ('{district} CCTV 통합관제센터', '공공 CCTV 영상 열람 요청'),
}
RULES = {
    'FALL_SUSPECTED': ['FIRE_119', 'CCTV_CENTER'],
    'VEHICLE_OBSTRUCTION': ['DISTRICT_OFFICE', 'POLICE_112'],
    'ABANDONED_OBJECT': ['DISTRICT_OFFICE', 'POLICE_112'],
    'POTHOLE': ['DISTRICT_OFFICE'],
    'SMOKING': ['PUBLIC_HEALTH'],
    'OTHER': ['DISTRICT_OFFICE'],
}
REASONS = {
    'FIRE_119': '쓰러짐 의심 신고는 생명·신체 위험 가능성이 있어 구조·응급 판단이 먼저입니다.',
    'POLICE_112': '통행·안전 위험이나 위험물 의심이 있으면 현장 통제가 필요할 수 있습니다.',
    'DISTRICT_OFFICE': '주정차 단속·도로 보수·방치물 처리는 관할 구·군청 업무입니다.',
    'PUBLIC_HEALTH': '금연구역 흡연 단속은 관할 보건소 업무입니다.',
    'CCTV_CENTER': '사건 장소 주변 공공 CCTV 영상은 관할 관제센터를 통해서만 열람할 수 있습니다.',
}


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
    lines = [f"[모의] 시민 신고 #{report['report_id'][:6].upper()} · 사건 유형 {incident}",
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
    if incident == 'FALL_SUSPECTED' and 'FIRE_119' not in seen:
        rows.insert(0, {'agency': 'FIRE_119', 'name': name_of('FIRE_119', district), 'reason': REASONS['FIRE_119'],
                        'message': brief(report, analysis)})
    return {**recommendation, 'agencies': rows[:3], 'district': district}
