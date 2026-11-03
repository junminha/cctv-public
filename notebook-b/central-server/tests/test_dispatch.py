"""Simulated agency connection: fixed agency list, rules fallback, GPT picks constrained, records only."""
from types import SimpleNamespace

from intelligence import AgencyPick, AgencyPlan, Intelligence
from test_intelligence import engine

REPORT = {'report_id': 'a' * 32, 'latitude': 35.1336, 'longitude': 129.103, 'details': '공학관 1층',
          'description': '복도에 사람이 쓰러져 있어요'}
FALL = {'classification': {'incident_type': 'FALL_SUSPECTED'},
        'nearby': {'public': {'recommended': [{'kind': 'webcam', 'district': None},
                                              {'kind': 'public', 'district': '남구'}]}}}


def test_rules_pick_agencies_by_incident_and_name_the_district():
    result = Intelligence(SimpleNamespace(openai_api_key='')).recommend_agencies(REPORT, FALL)
    assert result['source'] == 'local_rules' and result['district'] == '남구'
    assert [row['agency'] for row in result['agencies']] == ['FIRE_119', 'CCTV_CENTER']
    assert result['agencies'][1]['name'] == '남구 CCTV 통합관제센터'
    assert '[모의]' in result['agencies'][0]['message'] and '공학관 1층' in result['agencies'][0]['message']
    assert result['warnings']


def test_gpt_choice_stays_in_the_list_and_fall_always_includes_119():
    ai, calls = engine(AgencyPlan(agencies=[AgencyPick(agency='DISTRICT_OFFICE', reason='r', message='m'),
                                            AgencyPick(agency='DISTRICT_OFFICE', reason='dup', message='m')]))
    result = ai.recommend_agencies(REPORT, FALL)
    assert result['source'] == 'openai:test-model'
    assert [row['agency'] for row in result['agencies']] == ['FIRE_119', 'DISTRICT_OFFICE']
    assert result['agencies'][1]['name'] == '남구청 담당 부서'
    assert '모의 연결' in calls.calls[0]['input'] and 'FIRE_119' in calls.calls[0]['input']


def test_gpt_failure_falls_back_to_rules():
    ai, _ = engine(RuntimeError('network'))
    result = ai.recommend_agencies(REPORT, {'classification': {'incident_type': 'POTHOLE'}})
    assert result['source'] == 'local_rules' and [row['agency'] for row in result['agencies']] == ['DISTRICT_OFFICE']
    assert result['district'] == '관할 구·군' and 'OpenAI' in result['warnings'][0]
