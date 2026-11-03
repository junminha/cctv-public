"""Radius CCTV guide and responder plan: counts, public ranking from metadata only, safe steps."""
import guidance
import pytest
from public_catalog import list_cameras

REPORT = {'description': '부산대후문삼거리 앞에 차가 통행로를 막고 있어요', 'details': '', 'latitude': 35.2310,
          'longitude': 129.0840, 'location_kind': 'real', 'radius_m': 300}


def fake_catalog(monkeypatch, cameras):
    source = {'title': '테스트 자료'}

    def listing(bounds=None, limit=100, offset=0):
        west, south, east, north = bounds
        inside = [c for c in cameras if west <= c['longitude'] <= east and south <= c['latitude'] <= north]
        return {'cameras': inside[offset:offset + limit], 'total': len(inside), 'source': source}
    monkeypatch.setattr(guidance, 'list_cameras', listing)


def camera(id_, name, lat, lon, district='금정구'):
    return {'id': id_, 'name': name, 'district': district, 'purpose': '생활방범', 'latitude': lat, 'longitude': lon}


def test_public_cctv_in_radius_is_counted_by_device_and_site(monkeypatch):
    fake_catalog(monkeypatch, [
        camera('a1', '장전동_골목_고1', 35.2311, 129.0841), camera('a2', '장전동_골목_고2', 35.2311, 129.0841),
        camera('b', '구-0270-장전2동_부산대후문삼거리_고2', 35.2320, 129.0850),
        camera('far', '먼 곳 사거리', 35.2500, 129.0840)])
    result = guidance.nearby(REPORT, 'VEHICLE_OBSTRUCTION', ['통행로'], [])
    public = result['public']
    assert public['devices'] == 3 and public['sites'] == 2 and public['purposes'] == {'생활방범': 3}
    assert all(row['distance_m'] <= REPORT['radius_m'] for row in public['recommended'])
    top = public['recommended'][0]
    # A road junction named in the report outranks a slightly closer alley camera for a vehicle report.
    assert top['id'] == 'b' and top['place'] == '도로·교차로'
    assert any('부산대후문삼거리' in reason for reason in top['reasons'])
    alley = public['recommended'][1]
    assert alley['device_count'] == 2 and alley['place'] == '주거지 골목'
    assert '영상은 열람·분석하지 않습니다' in public['note']


def test_real_catalog_answers_for_a_busan_point():
    site = next(c for c in list_cameras(limit=25000)['cameras'] if '사거리' in c['name'])
    report = {**REPORT, 'description': '', 'latitude': site['latitude'], 'longitude': site['longitude'], 'radius_m': 200}
    public = guidance.nearby(report, 'OTHER', [], [])['public']
    assert public['devices'] >= 1 and 1 <= public['sites'] <= public['devices']
    assert public['recommended'][0]['distance_m'] < 1
    assert set(public['purposes']) == {'생활방범'}


def test_place_hints_and_report_terms():
    assert guidance.place_of('(10차)대저2동 근린공원(고1)') == '공원·산책로'
    assert guidance.place_of('부산_영도_08_174') is None
    assert {'정문', '복도'} <= guidance.terms('정문 안쪽 복도에 사람이 있어요')


def analysed(**changes):
    result = {'classification': {'incident_type': 'FALL_SUSPECTED'}, 'outcome': 'VIDEO_NOT_VISIBLE',
              'cameras': [{'camera_id': 'cam-01', 'status': 'available', 'distance_m': 5, 'zone': 'Z1'}],
              'selected_camera_ids': [], 'summary': {'source': 'local_rules', 'unverified_facts': ['의식 미확인']},
              'nearby': {'webcams': {'cameras': [{'id': 'cam-01', 'name': '내장', 'latitude': 35.1, 'longitude': 129.0}]},
                         'public': {'sites': 1, 'recommended': [{
                             'id': 'p', 'name': '장전동 사거리', 'district': '금정구', 'latitude': 35.2311,
                             'longitude': 129.0841, 'distance_m': 40.0, 'place': '도로·교차로'}]}}}
    result.update(changes)
    return result


def test_fall_report_always_starts_with_119_even_without_video():
    plan = guidance.plan(REPORT, analysed())
    assert plan['priority'] == 'urgent'
    assert '119' in plan['steps'][0]['action'] and '119' in plan['contacts']
    assert any('금정구 관제센터' in step['action'] and '장전동 사거리' in step['action'] for step in plan['steps'])
    assert '의식 미확인' in plan['cautions'] and plan['source'] == 'local_rules'
    assert not any('보존' in step['action'] for step in plan['steps'])


def test_video_candidate_becomes_best_camera_and_adds_review_and_preserve_steps():
    result = analysed(outcome='REVIEW_REQUIRED', selected_camera_ids=['cam-01'],
                      cameras=[{'camera_id': 'cam-01', 'status': 'available', 'distance_m': 5, 'zone': 'Z1',
                                'event_score': 0.6, 'focus': {'observations': [{'finding': '누운 자세 후보'}]}}])
    best = guidance.best_camera(result)
    assert best['video']['camera_id'] == 'cam-01' and '누운 자세 후보' in best['video']['reason']
    assert best['video']['latitude'] == 35.1 and best['public']['id'] == 'p'
    plan = guidance.plan({**REPORT, 'location_kind': 'demo'}, {**result, 'best_camera': best})
    actions = ' '.join(step['action'] for step in plan['steps'])
    assert 'cam-01 근거 프레임' in actions and '보존' in actions
    assert any('시연 지점' in caution for caution in plan['cautions'])


def test_vehicle_and_unknown_reports_name_the_district_office():
    vehicle = guidance.plan(REPORT, analysed(classification={'incident_type': 'VEHICLE_OBSTRUCTION'}))
    assert vehicle['priority'] == 'normal' and '금정구청 주정차 단속' in vehicle['contacts']
    assert '119' not in vehicle['contacts']
    none = guidance.plan(REPORT, analysed(classification={'incident_type': 'OTHER'}, outcome='NO_CAMERA_IN_RANGE',
                                          nearby={'webcams': {'cameras': []}, 'public': {'recommended': []}}))
    assert any('반경을 넓혀' in step['action'] for step in none['steps'])
    assert not any('관제센터' in step['action'] for step in none['steps'])


@pytest.mark.parametrize(('outcome', 'cameras'), [
    ('VIDEO_NOT_VISIBLE', [{'camera_id': 'cam-01', 'status': 'available'}]),
    ('RECORDING_UNAVAILABLE', [{'camera_id': 'cam-01', 'status': 'RECORDING_UNAVAILABLE'}]),
    ('NO_CAMERA_IN_RANGE', [])])
def test_expanded_search_always_cautions_about_its_wider_area(outcome, cameras):
    result = analysed(outcome=outcome, cameras=cameras,
                      search={'base_radius_m': 100, 'radius_m': 300, 'expanded': True})
    plan = guidance.plan({**REPORT, 'radius_m': 100}, result)
    assert any('신고 반경 100m 안에 웹캠이 없어 300m까지 자동 확대해 검색했습니다.' in caution
               and '사건 장소와 떨어져 있을 수 있습니다' in caution for caution in plan['cautions'])
    unchanged = guidance.plan({**REPORT, 'radius_m': 100},
                              analysed(search={'base_radius_m': 100, 'radius_m': 100, 'expanded': False}))
    assert not any('자동 확대' in caution for caution in unchanged['cautions'])


def test_exhausted_search_explains_both_radii_without_claiming_a_camera_was_found():
    result = analysed(outcome='NO_CAMERA_IN_RANGE', cameras=[],
                      search={'base_radius_m': 100, 'radius_m': 300, 'expanded': True},
                      nearby={'webcams': {'cameras': []}, 'public': {'recommended': []}})
    # The analysis records its own original radius even if the report was subsequently edited.
    plan = guidance.plan({**REPORT, 'radius_m': 500}, result)
    assert any(step['reason'] == '반경 100m에서 300m까지 넓혀도 영상 분석이 가능한 웹캠이 없습니다.'
               for step in plan['steps'])
    assert not any('넓혀 찾은 카메라' in caution for caution in plan['cautions'])


def test_fractional_radius_is_not_an_expansion_when_only_its_display_is_rounded():
    result = analysed(outcome='NO_CAMERA_IN_RANGE', cameras=[],
                      search={'base_radius_m': 99.6, 'radius_m': 99.6, 'expanded': False},
                      nearby={'webcams': {'cameras': []}, 'public': {'recommended': []}})
    plan = guidance.plan({**REPORT, 'radius_m': 99.6}, result)
    reasons = ' '.join(step['reason'] for step in plan['steps'])
    assert '반경 100m 안에' in reasons and '까지 넓혀도' not in reasons


def detail(**changes):
    base = {'created_at': '2026-10-26T01:00:00Z', 'description': '복도에 사람이 쓰러져 있어요', 'details': '',
            'job': {'state': 'queued', 'params': None}, 'events': [], 'review': None, 'analysis': None}
    return {**base, **changes}


def test_fall_report_is_urgent_at_intake_before_any_analysis():
    state = guidance.alert_state(detail())
    assert state == {'priority': 'urgent', 'priority_basis': 'keywords', 'alert_acknowledged': False, 'response_logs': 0,
                     'dispatches': 0}
    assert guidance.alert_state(detail(description='주차장에 차가 오래 서 있어요'))['priority'] == 'normal'
    analysed_ = detail(analysis={'response_plan': {'priority': 'high'}},
                       events=[{'type': 'response_log', 'created_at': 'x', 'data': {'kind': 'alert_ack'}}])
    assert guidance.alert_state(analysed_) == {'priority': 'high', 'priority_basis': 'analysis',
                                              'alert_acknowledged': True, 'response_logs': 1, 'dispatches': 0}
    assert guidance.alert_state(detail(review={'confirmed_at': 'x'}))['alert_acknowledged'] is True


def test_citizen_handling_shows_stages_and_times_only():
    events = [{'type': 'analysis_requested', 'created_at': 't1', 'data': {}},
              {'type': 'analysis_finished', 'created_at': 't2', 'data': {}},
              {'type': 'response_log', 'created_at': 't3', 'data': {'by': 'admin', 'text': '현장 전달'}}]
    view = guidance.handling(detail(events=events, job={'state': 'completed', 'params': {}}))
    assert view['state'] == 'responding' and view['label'] == '담당자 대응 중'
    assert [row['state'] for row in view['timeline']] == ['received', 'analyzing', 'analyzed', 'responding']
    assert 'admin' not in str(view) and '현장 전달' not in str(view)
    closed = guidance.handling(detail(events=events, review={'confirmed_at': 't4', 'closed_at': 't5'},
                                      job={'state': 'completed', 'params': {}}))
    assert closed['state'] == 'closed' and closed['timeline'][-1]['at'] == 't5'
    rerun = guidance.handling(detail(events=events[:2], job={'state': 'running', 'params': {}}))
    assert rerun['state'] == 'analyzing'


def test_demo_webcams_rank_with_public_cctv_on_the_same_terms(monkeypatch):
    fake_catalog(monkeypatch, [camera('far-junction', '부산대후문삼거리', 35.2330, 129.0840)])
    webcams = [{'id': 'cam-02', 'name': 'USB 카메라 1', 'zone': '전시 부스 사거리', 'latitude': 35.2311,
                'longitude': 129.0841, 'distance_m': 15.0},
               {'id': 'cam-03', 'name': None, 'zone': None, 'latitude': None, 'longitude': None, 'distance_m': 20.0}]
    public = guidance.nearby(REPORT, 'VEHICLE_OBSTRUCTION', [], webcams)['public']
    # A webcam without a registered position cannot be ranked; the placed one counts like a site.
    assert public['devices'] == 2 and public['sites'] == 2 and public['webcams'] == 1
    assert public['purposes'] == {'생활방범': 1, '시연 웹캠': 1}
    top = public['recommended'][0]
    assert top['kind'] == 'webcam' and top['id'] == 'cam-02' and top['purpose'] == '시연 웹캠'
    assert top['place'] == '도로·교차로' and '영상 분석 가능(시연 웹캠)' in top['reasons']
    assert public['recommended'][1]['kind'] == 'public'
    result = analysed(classification={'incident_type': 'VEHICLE_OBSTRUCTION'},
                      nearby={'webcams': {'cameras': []}, 'public': public})
    plan = guidance.plan(REPORT, result)
    actions = ' '.join(step['action'] for step in plan['steps'])
    assert 'cam-02' in actions and '시연 웹캠' in actions and '관제센터' not in actions
    assert '금정구청 주정차 단속' in plan['contacts']
