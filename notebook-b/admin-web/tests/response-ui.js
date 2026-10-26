// Urgent alert, map recommendation pins, response logs and per-type metrics, with synthetic responses only.
// Run from the repo root with a dedicated Playwright CLI session:
// npx --yes --package @playwright/cli playwright-cli -s=response open http://127.0.0.1:3000
// npx --yes --package @playwright/cli playwright-cli -s=response --raw run-code --filename=notebook-b/admin-web/tests/response-ui.js
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- Playwright CLI consumes this function expression.
async page => {
  const base = 'http://127.0.0.1:3000';
  const urgent = 'aaaa1111bbbb2222cccc3333dddd4444';
  const done = 'eeee5555ffff6666aaaa7777bbbb8888';
  const closed = '99990000aaaabbbbccccddddeeeeffff';
  const confirmed = '1234567890abcdef1234567890abcdef';
  const now = Date.now();
  const iso = (ago) => new Date(now - ago).toISOString();
  const rec = (i, place) => ({ id: `public-${i}`, name: `검증용 ${place} CCTV ${i}`, district: '사하구', purpose: '생활방범',
    latitude: 35.0931 + i * 0.0006, longitude: 128.987 + i * 0.0005, distance_m: 40 * i, device_count: i, place,
    score: 0.9 - i * 0.1, reasons: [`신고 지점에서 ${40 * i}m`] });
  const nearby = { radius_m: 300, center: { latitude: 35.0931, longitude: 128.987 }, location_kind: 'demo',
    webcams: { total: 0, cameras: [] },
    public: { devices: 9, sites: 3, purposes: { '생활방범': 9 }, places: {}, recommended: [rec(1, '사거리'), rec(2, '공원'), rec(3, '골목')],
      source: '검증용 자료', note: '공개 위치정보만 사용했습니다. 공공 CCTV 영상은 열람·분석하지 않습니다.' } };
  const job = (id, state, stage) => ({ id: `j-${id}`, report_id: id, state, stage, progress: state === 'completed' ? 1 : 0, error: null,
    params: { mode: 'selective', source: 'live', duration: 10, sample_fps: 1, focus_fps: 3, top_k: 1 } });
  const summary = { [urgent]: { report_id: urgent, source: 'reporter', created_at: iso(5000), description: '정문 앞에 사람이 쓰러져 있어요',
      latitude: 35.0931, longitude: 128.987, location_kind: 'demo', radius_m: 300, job: { ...job(urgent, 'queued', 'awaiting_worker'), params: null },
      review: null, outcome: null, selected_camera_ids: [], incident_type: null,
      priority: 'urgent', priority_basis: 'keywords', alert_acknowledged: false, response_logs: 0 },
    [done]: { report_id: done, source: 'demo', created_at: iso(600000), description: '주차장 입구를 차가 막고 있어요',
      latitude: 35.0931, longitude: 128.987, location_kind: 'demo', radius_m: 300, job: job(done, 'completed', 'VIDEO_NOT_VISIBLE'),
      review: null, outcome: 'VIDEO_NOT_VISIBLE', selected_camera_ids: [], incident_type: 'VEHICLE_OBSTRUCTION',
      priority: 'normal', priority_basis: 'analysis', alert_acknowledged: false, response_logs: 1 } };
  summary[closed] = { ...summary[done], report_id: closed, description: '처리가 끝난 검증 신고', job: job(closed, 'completed', 'VIDEO_NOT_VISIBLE'),
    review: { confirmed_at: iso(400000), confirmed_by: 'synthetic', closed_at: iso(300000), closed_by: 'synthetic' }, response_logs: 0 };
  summary[confirmed] = { ...summary[closed], report_id: confirmed, description: '담당자 확인을 마친 검증 신고', job: job(confirmed, 'completed', 'VIDEO_NOT_VISIBLE'),
    review: { confirmed_at: iso(400000), confirmed_by: 'synthetic', closed_at: null, closed_by: null } };
  const events = { [urgent]: [{ created_at: iso(5000), type: 'received', message: '신고 접수', data: {} }],
    [done]: [{ created_at: iso(600000), type: 'received', message: '신고 접수', data: {} },
      { created_at: iso(599000), type: 'analysis_requested', message: '분석 요청', data: {} },
      { created_at: iso(590000), type: 'analysis_finished', message: 'VIDEO_NOT_VISIBLE', data: {} },
      { created_at: iso(595000), type: 'response_log', message: '이전 분석의 대응 단계 2 실행', data: { by: 'previous', kind: 'step', step: 1 } },
      { created_at: iso(500000), type: 'response_log', message: '대응 단계 1 실행', data: { by: 'admin', kind: 'step', step: 0, text: '신고자에게 위치 확인' } }] };
  events[closed] = [];
  events[confirmed] = [];
  const analysis = { report_id: done, mode: 'selective', params: job(done).params, started_at: iso(599000), finished_at: iso(590000),
    outcome: 'VIDEO_NOT_VISIBLE', cameras: [], selected_camera_ids: [], phone: [], warnings: [],
    classification: { incident_type: 'VEHICLE_OBSTRUCTION', keywords: [], source: 'local_keywords', warnings: [] },
    nearby, best_camera: { video: null, public: nearby.public.recommended[0], note: '위치정보 기준' },
    response_plan: { priority: 'normal', priority_label: '보통', source: 'local_rules', contacts: ['사하구청 주정차 단속'], cautions: ['추천은 참고용입니다.'],
      steps: [{ action: '신고자에게 상세 위치를 다시 확인하세요.', reason: '웹캠에서 장면 없음' },
        { action: '사하구청 주정차 단속 부서에 차량 위치를 전달하세요.', reason: '판정하지 않음' }] } };
  const detail = (id) => ({ ...summary[id], details: '', occurred_at: null, owner: 'x', attachments: [], events: events[id], analysis: id === done ? analysis : null });
  const posted = [];
  const analysisRequests = [];
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error).slice(0, 160)));
  await page.context().addCookies([{ name: 'cctv_admin', value: 'synthetic-ui-check', domain: '127.0.0.1', path: '/' }]);
  await page.route('https://*.tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204 }));
  await page.route('**/api/b/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path.endsWith('/ws-ticket')) return route.fulfill({ json: { ticket: 't', expires_in: 30 } });
    if (path.endsWith('/public-cameras')) return route.fulfill({ json: { cameras: [], total: 0, source: {} } });
    if (path.endsWith('/admin/metrics')) return route.fulfill({ json: { reports: { reporter: 3 }, jobs: {}, attachments: 0, preserved_clips: 0, confirmed: 1, closed: 0,
      outcomes: { VIDEO_NOT_VISIBLE: 2 }, latency_seconds: { count: 2, mean: 14, median: 14, p95: 16 }, benchmarks: [], note: '',
      by_incident: { FALL_SUSPECTED: { count: 2, review_required: 1, mean_processing_seconds: 12.4, mean_latency_seconds: 14.9, mean_frames: 51 },
        VEHICLE_OBSTRUCTION: { count: 1, review_required: 0, mean_processing_seconds: 6.2, mean_latency_seconds: 8.1, mean_frames: 30 } },
      frame_reduction: { count: 2, mean: 0.61, min: 0.55, max: 0.67 } } });
    const id = path.split('/reports/')[1]?.split('/')[0];
    if (!summary[id]) return route.fulfill({ status: 404, json: {} });
    if (path.endsWith('/nearby')) return route.fulfill({ json: nearby });
    if (path.endsWith('/clips')) return route.fulfill({ json: { clips: [] } });
    if (path.endsWith('/analyze')) {
      analysisRequests.push({ id, ...route.request().postDataJSON() });
      return route.fulfill({ status: 202, json: summary[id].job });
    }
    if (path.endsWith('/log')) {
      const body = route.request().postDataJSON();
      posted.push(`${id.slice(0, 4)}:${body.kind}:${body.step ?? ''}:${body.text ?? ''}`);
      const message = body.kind === 'alert_ack' ? '긴급 알림 확인' : body.kind === 'note' ? '대응 메모' : `대응 단계 ${body.step + 1} 실행`;
      const entry = { created_at: new Date().toISOString(), type: 'response_log', message, data: { by: 'admin', ...body } };
      events[id].push(entry);
      summary[id].response_logs += 1;
      if (body.kind === 'alert_ack') summary[id].alert_acknowledged = true;
      return route.fulfill({ status: 201, json: { ...entry.data, created_at: entry.created_at, message } });
    }
    return route.fulfill({ json: detail(id) });
  });
  await page.routeWebSocket('ws://127.0.0.1:8000/ws/v1/admin', (ws) => {
    const send = () => ws.send(JSON.stringify({ type: 'snapshot', reports: Object.values(summary), cameras: [], time: new Date().toISOString(), worker_running: true }));
    ws.onMessage(() => { send(); const timer = setInterval(send, 500); ws.onClose(() => clearInterval(timer)); });
  });

  const results = [];
  const check = (name, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  const panel = () => page.getByRole('complementary', { name: '신고 상세', exact: true });
  const tabs = () => panel().getByRole('tablist', { name: '신고 상세 탭' });
  const tab = (name) => tabs().getByRole('tab', { name, exact: true });
  const situation = () => panel().getByRole('region', { name: '상황 카드' });
  const nextTask = () => situation().getByText('다음 할 일', { exact: true }).locator('..');
  async function selectedTab(name) {
    await tabs().getByRole('tab', { name, exact: true, selected: true }).waitFor({ timeout: 5000 });
    await panel().getByRole('tabpanel').waitFor({ state: 'visible' });
    check(`detail tab ${name} is selected`, await tab(name).getAttribute('aria-selected') === 'true');
    const activePanel = panel().getByRole('tabpanel');
    check(`detail tab ${name} controls the active panel`, await activePanel.count() === 1
      && await tab(name).getAttribute('aria-controls') === await activePanel.getAttribute('id')
      && await activePanel.getAttribute('aria-labelledby') === await tab(name).getAttribute('id'));
  }

  for (const [w, h] of [[1920, 1080], [1366, 768]]) {
    await page.setViewportSize({ width: w, height: h });
    summary[urgent].alert_acknowledged = false;
    await page.goto(base + '/');
    await page.waitForSelector('.urgent-banner', { timeout: 8000 }).catch(() => {});
    check(`${w} banner shows the urgent report before analysis`, await page.locator('.urgent-banner').getByText('쓰러짐 의심 (신고문 기준)').count() === 1);
    const first = await page.locator('aside ul li button').first().textContent();
    check(`${w} urgent report is first in the queue`, first.includes('정문 앞에') && first.includes('긴급'));
    await page.getByRole('button', { name: /주차장 입구/ }).click();
    await page.waitForTimeout(1500);
    await selectedTab('대응');
    check(`${w} next task ignores steps from an older analysis`, (await nextTask().innerText()).includes('사하구청 주정차 단속 부서'));
    check(`${w} logged step shows time and actor`, await panel().locator('.guidance-logged').count() === 1
      && (await panel().locator('.guidance-logged').innerText()).includes('admin'));
    await tab('대응').focus();
    for (const [key, expected] of [['ArrowRight', 'CCTV'], ['ArrowRight', '신고 내용'], ['ArrowRight', '도구'],
      ['ArrowRight', '대응'], ['ArrowLeft', '도구'], ['Home', '대응'], ['End', '도구']]) {
      await page.keyboard.press(key);
      await selectedTab(expected);
      check(`${w} ${key} moves keyboard focus to ${expected}`, await tab(expected).evaluate(node => node === document.activeElement));
    }
    await tab('신고 내용').click();
    check(`${w} report content tab preserves the report text`, (await panel().getByRole('tabpanel').innerText()).includes('주차장 입구'));
    await tab('도구').click();
    check(`${w} tools tab preserves analysis and evidence controls`, await panel().getByRole('heading', { name: '분석 실행', exact: true }).count() === 1
      && await panel().getByRole('link', { name: /증거.*ZIP/ }).count() === 1);
    await page.getByRole('button', { name: /정문 앞에/ }).click();
    await tab('대응').waitFor();
    await selectedTab('대응');
    await tab('도구').click();
    const start = panel().getByRole('button', { name: '분석 시작', exact: true });
    check(`${w} analysis can start for queued intake without requested params`, await start.count() === 1 && await start.isEnabled());
    await tab('CCTV').click();
    await page.getByRole('button', { name: /주차장 입구/ }).click();
    await selectedTab('대응');
    await tab('CCTV').click();
    const pins = await page.locator('.rec-pin').allTextContents();
    check(`${w} numbered pins on the map`, pins.join(',') === '1,2,3', pins.join(','));
    check(`${w} first pin highlighted`, await page.locator('.rec-pin.top').count() === 1);
    check(`${w} table numbers match pins`, (await page.locator('.guidance-table .rec-num').allTextContents()).join(',') === '1,2,3');
    check(`${w} no horizontal overflow`, !(await overflow()));
    await page.screenshot({ path: `output/playwright/response-${w}-console.png` });
  }

  await page.locator('.rec-pin').first().click();
  await page.waitForTimeout(400);
  const popup = await page.locator('.leaflet-popup-content').textContent().catch(() => '');
  check('pin popup lists location and purpose', popup.includes('위도') && popup.includes('생활방범') && popup.includes('영상 미분석'), popup.slice(0, 60));
  await page.keyboard.press('Escape');

  const filters = page.getByRole('tablist', { name: '신고 목록 필터' });
  const queue = page.getByRole('complementary', { name: '접수된 신고', exact: true });
  for (const [filter, expected] of [['긴급', ['정문 앞에']], ['완료', ['처리가 끝난', '담당자 확인을 마친']], ['처리 중', ['정문 앞에', '주차장 입구']]]) {
    await filters.getByRole('tab', { name: new RegExp(`^${filter}`) }).click();
    const descriptions = await queue.locator('ul li button').allTextContents();
    check(`queue ${filter} filter shows only matching reports`, descriptions.length === expected.length
      && expected.every(text => descriptions.some(description => description.includes(text))), descriptions.join(' | '));
  }
  await page.getByRole('button', { name: /주차장 입구/ }).click();
  await tab('대응').click();
  check('next task remains the first unrecorded step before logging', (await nextTask().innerText()).includes('사하구청 주정차 단속 부서'));
  await page.getByRole('button', { name: '실행 기록' }).first().click();
  await page.waitForTimeout(800);
  check('next task changes after the current analysis step is recorded', !(await nextTask().innerText()).includes('사하구청 주정차 단속 부서')
    && /완료|모든.*기록|모두.*기록/.test(await nextTask().innerText()));
  await page.getByLabel('대응 메모').fill('구청에 전화함');
  await page.getByRole('button', { name: '기록', exact: true }).click();
  await page.waitForTimeout(800);
  check('step and memo posted', posted.includes('eeee:step:1:') && posted.includes('eeee:note::구청에 전화함'), posted.join(' | '));
  check('log list shows the memo', (await page.locator('.guidance-logs').textContent()).includes('구청에 전화함'));

  await page.locator('.urgent-banner').getByRole('button', { name: '확인' }).click();
  await page.waitForTimeout(1500);
  check('acknowledge posts alert_ack and clears the banner', posted.includes('aaaa:alert_ack::') && await page.locator('.urgent-banner').count() === 0);
  await page.screenshot({ path: 'output/playwright/response-1366-acked.png' });

  summary[urgent].alert_acknowledged = false;
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(base + '/live');
  await page.waitForTimeout(2000);
  check('/live banner and urgent tag', await page.locator('.urgent-banner').count() === 1 && await page.locator('.wall .urgent-tag').count() === 1);
  await page.getByRole('button', { name: /주차장 입구/ }).click();
  await page.waitForTimeout(1200);
  const logTags = await page.locator('.log-line .log-tag').allTextContents();
  check('/live shows response logs as LOG lines', logTags.filter((tag) => tag === 'LOG').length >= 3, logTags.join(','));
  check('/live no overflow', !(await overflow()));
  await page.screenshot({ path: 'output/playwright/response-1920-live.png' });

  await page.goto(base + '/metrics');
  await page.waitForTimeout(1200);
  const metricRows = await page.locator('table').first().locator('tbody tr').allTextContents();
  check('metrics per incident rows', metricRows.length === 2 && metricRows[0].includes('쓰러짐 의심') && metricRows[0].includes('12.4s'), metricRows.join(' / ').slice(0, 120));
  check('metrics frame reduction range', (await page.textContent('main')).includes('범위 55~67%'));
  await page.screenshot({ path: 'output/playwright/response-1920-metrics.png', fullPage: true });

  // Legacy jobs omit expand_steps: the form must merge new defaults without changing their other settings.
  summary[done].job.params.duration = 17;
  await page.goto(base + '/');
  await page.getByRole('button', { name: /주차장 입구/ }).click();
  await tab('도구').click();
  const expandSteps = panel().getByLabel('자동 확대 횟수', { exact: true });
  check('analysis tools expose configurable automatic expansion count', await expandSteps.count() === 1);
  if (await expandSteps.count()) {
    check('legacy analysis params receive expansion default 2 and preserve duration', await expandSteps.inputValue() === '2'
      && await panel().getByLabel('길이 (초)').inputValue() === '17');
    check('expansion count input defines integer range 0 to 5', await expandSteps.getAttribute('min') === '0'
      && await expandSteps.getAttribute('max') === '5' && await expandSteps.getAttribute('step') === '1');
    const analyze = () => panel().getByRole('button', { name: '다시 분석', exact: true });
    for (const invalid of ['-1', '6', '1.5', '']) {
      await expandSteps.fill(invalid);
      check(`invalid expansion count ${invalid || 'empty'} blocks analysis`, await analyze().isDisabled());
    }
    for (const count of [0, 5]) {
      await expandSteps.fill(String(count));
      await analyze().click();
      await page.waitForTimeout(400);
      check(`analysis request posts configured expansion count ${count}`, analysisRequests.some(body => body.id === done
        && body.expand_steps === count && body.duration === 17));
    }
    await expandSteps.fill('2');
    for (const width of [1920, 1366]) {
      await page.setViewportSize({ width, height: width === 1920 ? 1080 : 768 });
      await panel().getByRole('heading', { name: '분석 실행', exact: true }).scrollIntoViewIfNeeded();
      check(`${width} expansion tools preserve viewport`, await page.evaluate(() =>
        document.documentElement.scrollWidth <= innerWidth + 1 && document.documentElement.scrollHeight <= innerHeight + 1));
      await page.screenshot({ path: `output/playwright/expand-${width}-tools.png` });
    }
    await page.getByRole('button', { name: /정문 앞에/ }).click();
    await tab('도구').click();
    check('intake without params receives expansion default 2', await expandSteps.inputValue() === '2');
  }

  check('no page errors', errors.length === 0, errors.join(' / '));
  return results.join('\n');
}
