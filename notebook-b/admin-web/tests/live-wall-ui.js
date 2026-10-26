// Synthetic /live behavior and layout regression checks; no actual camera or B access.
// npx --yes --package @playwright/cli playwright-cli -s=livev2 open http://127.0.0.1:3000
// npx --yes --package @playwright/cli playwright-cli -s=livev2 --raw run-code --filename=notebook-b/admin-web/tests/live-wall-ui.js
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- Playwright CLI consumes this function expression.
async page => {
  const first = '11111111222233334444555566667777';
  const second = '8888888899990000aaaabbbbccccdddd';
  const epoch = Date.now() - 60000;
  const at = seconds => new Date(epoch + seconds * 1000).toISOString();
  const params = { mode: 'selective', source: 'live', duration: 10, sample_fps: 1, focus_fps: 3, top_k: 1 };
  const stages = ['CLASSIFIED', 'CANDIDATES_FOUND', 'SCANNING', 'FOCUSED_ANALYSIS', 'SUMMARIZING'];
  const event = (seconds, type, message, data = {}) => ({ created_at: at(seconds), type, message, data });
  const publicCamera = { id: 'public-synthetic', name: '합성 위치 CCTV', latitude: 35.23112, longitude: 129.08412,
    district: '테스트구', purpose: '생활방범', distance_m: 42, device_count: 2, place: '도로·교차로', score: .82, reasons: ['신고 지점에서 42m'] };
  const nearby = { radius_m: 300, center: { latitude: 35.231, longitude: 129.084 }, location_kind: 'demo',
    webcams: { total: 3, cameras: ['cam-01', 'cam-02', 'cam-03'].map((id, i) => ({ id, name: `합성 웹캠 ${i + 1}`, zone: '시연 구역', latitude: 35.231, longitude: 129.084, distance_m: 10 + i })) },
    public: { devices: 2, sites: 1, purposes: { '생활방범': 2 }, places: {}, recommended: [publicCamera], source: '합성 공개 위치정보', note: '공공 CCTV 영상은 열람·분석하지 않습니다.' } };
  const vision = { observations: [{ finding: '고유한 현재 근거 후보', kind: 'lying_person', verified: false }],
    evidence: [{ file: 'evidence-01.jpg', path: 'focus/cam-01/evidence-01.jpg', timestamp_seconds: 3, findings: ['고유한 현재 근거 후보'] }],
    relevance_score: .7, processed_frames: 31, elapsed_seconds: 1.2, device: 'cuda:0', models: { yolo: 'synthetic-yolo.pt', pose: 'synthetic-pose.task' }, warnings: [] };
  function detail(id, description) {
    return { report_id: id, description, source: 'demo', created_at: at(0), latitude: 35.231, longitude: 129.084,
      location_kind: 'demo', radius_m: 300, review: null, outcome: 'REVIEW_REQUIRED', selected_camera_ids: ['cam-01'],
      incident_type: 'FALL_SUSPECTED', priority: 'normal', priority_basis: 'analysis', alert_acknowledged: false, response_logs: 3,
      job: { id: `job-${id}`, report_id: id, state: 'completed', stage: 'REVIEW_REQUIRED', progress: 1, params },
      details: '합성 검증 자료', occurred_at: null, owner: 'synthetic', attachments: [
        { attachment_id: 'photo', kind: 'image', bytes: 1024, created_at: at(1), content_type: 'image/jpeg' },
        { attachment_id: 'voice', kind: 'audio', bytes: 1024, created_at: at(1), content_type: 'audio/wav' }],
      events: [event(0, 'received', '신고 접수'), event(1, 'attachment', '사진 수신', { kind: 'image' }),
        event(2, 'analysis_requested', '첫 분석 요청', params), event(3, 'stage', 'CLASSIFIED'), event(4, 'analysis_finished', 'VIDEO_NOT_VISIBLE'),
        event(5, 'analysis_rerun', '첨부 반영'), event(6, 'response_log', '이전 실행의 단계 기록', { kind: 'step', step: 1, by: 'previous' }),
        event(10, 'analysis_requested', '현재 분석 요청', params), ...stages.map((stage, i) => event(11 + i, 'stage', stage)),
        event(12, 'radius_expanded', '검색 반경 자동 확대 300m → 500m', { from: 300, to: 500, webcams: 3 }),
        event(20, 'analysis_finished', 'REVIEW_REQUIRED'), event(21, 'response_log', '현재 실행의 첫 단계 기록', { kind: 'step', step: 0, by: 'synthetic' }),
        event(22, 'response_log', '이전 실행 기록도 모두 남김', { kind: 'note', text: '전체 로그 보존 검증', by: 'synthetic' }),
        event(23, 'confirmed', '담당자 확인'), event(24, 'closed', '사건 종결')],
      analysis: { report_id: id, mode: 'selective', params, started_at: at(10), finished_at: at(20), outcome: 'REVIEW_REQUIRED',
        classification: { incident_type: 'FALL_SUSPECTED', keywords: [], source: 'local_keywords', warnings: [] },
        candidates: [{ camera_id: 'cam-01', distance_m: 10, zone: '시연 구역' }], cameras: [
          { camera_id: 'cam-01', distance_m: 10, zone: '시연 구역', status: 'available', event_score: .7, rank_score: .8,
            scan: { ...vision, processed_frames: 10, evidence: [], observations: [] }, focus: vision }],
        selected_camera_ids: ['cam-01'], phone: [{ attachment_id: 'voice', kind: 'audio', transcript: '합성 전사문', source: 'local_synthetic' },
          { attachment_id: 'photo', kind: 'image', analysis: { ...vision, evidence: [] } }], warnings: ['합성 경고: 담당자 확인 필요'], nearby,
        best_camera: { video: { camera_id: 'cam-01', name: '합성 웹캠 1', latitude: 35.231, longitude: 129.084, distance_m: 10, zone: '시연 구역', event_score: .7, reason: '관련 장면 후보' }, public: publicCamera, note: '웹캠 우선 확인' },
        response_plan: { priority: 'normal', priority_label: '보통', source: 'local_rules', contacts: ['119'], cautions: ['담당자가 직접 확인합니다.'],
          steps: [{ action: '현재 실행 첫 번째 조치', reason: '합성 첫 단계' }, { action: '현재 실행 두 번째 조치', reason: '합성 다음 단계' },
            { action: '현재 실행 세 번째 조치', reason: '합성 미래 단계 이유' }] },
        summary: { source: 'local_synthetic', cctv_observations: [], phone_observations: [], unverified_facts: [], requires_human_review: true },
        processing_seconds: 10, latency_seconds: 20 } };
  }
  let records, disconnected = false, broken = false, detailGate = null;
  const reset = () => { records = { [first]: detail(first, '타임라인 검증 신고 하나'), [second]: detail(second, '타임라인 검증 신고 둘') }; };
  reset();
  const errors = [], artifacts = [], writes = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.context().addCookies([{ name: 'cctv_admin', value: 'synthetic-ui-check', domain: '127.0.0.1', path: '/' }]);
  await page.route('**/api/b/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith('/ws-ticket')) return route.fulfill({ json: { ticket: 'synthetic', expires_in: 30 } });
    if (request.method() !== 'GET') writes.push(path);
    if (path.includes('/artifacts/')) {
      artifacts.push({ path, url: request.url(), cookie: (await request.allHeaders()).cookie || '' });
      if (broken) return route.fulfill({ status: 503, body: '' });
      return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZl8AAAAASUVORK5CYII=', 'base64') });
    }
    const id = path.split('/reports/')[1]?.split('/')[0];
    if (!records[id]) return route.fulfill({ status: 404, json: {} });
    if (path.endsWith('/nearby')) return route.fulfill({ json: nearby });
    if (detailGate) await detailGate;
    return route.fulfill({ json: records[id] });
  });
  await page.routeWebSocket('ws://127.0.0.1:8000/ws/v1/admin', ws => {
    if (disconnected) { ws.close(); return; }
    const send = () => ws.send(JSON.stringify({ type: 'snapshot', reports: Object.values(records), cameras: [], time: at(25), worker_running: true }));
    ws.onMessage(() => { send(); const timer = setInterval(send, 200); ws.onClose(() => clearInterval(timer)); });
  });
  const results = [];
  const check = (name, ok, info = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`);
  const sidebar = () => page.getByRole('complementary', { name: '분석 기록', exact: true });
  const tabs = () => sidebar().getByRole('tablist', { name: '분석 기록 탭', exact: true });
  const tab = name => tabs().getByRole('tab', { name, exact: true });
  const timeline = () => page.locator('article[aria-label="진행 타임라인"]');
  const situation = () => page.getByRole('region', { name: '상황 카드', exact: true });
  async function selected(name) {
    await tabs().getByRole('tab', { name, exact: true, selected: true }).waitFor({ timeout: 5000 });
    check(`selected tab ${name}`, await tab(name).getAttribute('aria-selected') === 'true');
    const active = sidebar().getByRole('tabpanel');
    check(`${name} tab controls its visible panel`, await active.count() === 1 && await tab(name).getAttribute('aria-controls') === await active.getAttribute('id')
      && await active.getAttribute('aria-labelledby') === await tab(name).getAttribute('id'));
  }
  async function visit() {
    await page.goto('http://127.0.0.1:3000/live');
    await page.locator('.wall-workspace').waitFor({ timeout: 7000 });
    if (Object.keys(records).length && !disconnected) {
      await page.getByRole('button', { name: /타임라인 검증 신고 하나/ }).waitFor();
      await situation().locator('.display').filter({ hasText: '타임라인 검증 신고 하나' }).waitFor();
    }
  }
  async function layout(label) {
    const state = await page.evaluate(() => {
      const root = document.querySelector('main.wall');
      const visible = node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
      const rows = [...root.querySelectorAll('.log-line')].filter(visible);
      const cards = [...root.querySelectorAll('article, aside, .wall-situation, .wall-workspace')].filter(visible);
      return { overflow: document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1,
        clipped: cards.some(node => { const r = node.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.width < 30 || r.height < 20; }),
        overlap: rows.some((node, i) => i + 1 < rows.length && node.getBoundingClientRect().bottom > rows[i + 1].getBoundingClientRect().top + 2),
        rounded: [...root.querySelectorAll('*')].filter(visible).some(node => parseFloat(getComputedStyle(node).borderTopLeftRadius) > 0),
        grid: getComputedStyle(root.querySelector('.wall-workspace')).display === 'grid' };
    });
    check(`${label} workspace grid`, state.grid);
    check(`${label} no viewport overflow or clipped panels`, !state.overflow && !state.clipped, JSON.stringify(state));
    check(`${label} log rows do not overlap`, !state.overlap);
    check(`${label} square corners`, !state.rounded);
  }
  const stageColor = (selector, token) => timeline().locator(selector).first().evaluate((node, value) => {
    const probe = document.createElement('span'); probe.style.color = `var(${value})`; node.appendChild(probe);
    const expected = getComputedStyle(probe).color; probe.remove();
    return [getComputedStyle(node).color, getComputedStyle(node).backgroundColor].includes(expected);
  }, token);
  for (const width of [1920, 1366]) {
    await page.setViewportSize({ width, height: width === 1920 ? 1080 : 768 });
    reset(); records[first].job = { ...records[first].job, state: 'running', stage: 'SCANNING', progress: .5 };
    records[first].events.push(event(30, 'analysis_requested', '재분석 요청', params));
    await visit();
    check(`${width} situation region and six timeline stages`, await situation().count() === 1 && await timeline().locator('li.timeline-stage').count() === 6);
    check(`${width} numbered stage states`, await timeline().locator('.stage-number').allTextContents().then(values => values.map(value => Number(value.trim())).join(',') === '1,2,3,4,5,6')
      && await timeline().locator('li.timeline-stage').evaluateAll(nodes => nodes.every(node => /\b(done|now|todo|skip)\b/.test(node.className))));
    await selected('분석 자료·모델');
    check(`${width} running stage orange`, await stageColor('li.timeline-stage.now .stage-number', '--w-beacon'));
    check(`${width} future stages gray`, await stageColor('li.timeline-stage.todo .stage-number', '--w-soft'));
    await layout(`${width} running`);
    await page.screenshot({ path: `output/playwright/live-v2-${width}-running.png` });
    await tab('CCTV').click(); records[first] = detail(first, '타임라인 검증 신고 하나');
    await page.waitForFunction(() => document.querySelector('.wall-situation')?.textContent?.includes('현재 실행 두 번째 조치'), null, { timeout: 7000 });
    await selected('CCTV');
    check(`${width} user tab override survives completion`, await tab('CCTV').getAttribute('aria-selected') === 'true');
    await tab('대응').click();
    check(`${width} next task ignores previous-run step records`, (await situation().locator('.next-action').innerText()).includes('현재 실행 두 번째 조치'));
    check(`${width} completed stages teal`, await stageColor('li.timeline-stage.done .stage-number', '--w-tide'));
    await page.waitForFunction(() => {
      const image = document.querySelector('article[aria-label="진행 타임라인"] .evidence img');
      return image?.complete && image.naturalWidth > 0;
    }, null, { timeout: 7000 });
    check(`${width} center displays authenticated evidence`, await timeline().locator('.evidence img').count() > 0
      && await timeline().locator('.evidence img').first().evaluate(node => node.complete && node.naturalWidth > 0)
      && artifacts.some(item => item.path === `/api/b/api/v1/admin/reports/${first}/artifacts/focus/cam-01/evidence-01.jpg` && item.cookie.includes('cctv_admin=synthetic-ui-check')));
    const evidenceUrl = `/api/b/api/v1/admin/reports/${first}/artifacts/focus/cam-01/evidence-01.jpg?run=${encodeURIComponent(records[first].analysis.started_at)}`;
    check(`${width} center evidence src and original link identify the analysis run`, await timeline().locator('.evidence img').first().getAttribute('src') === evidenceUrl
      && await timeline().locator('.evidence a').first().getAttribute('href') === evidenceUrl
      && artifacts.some(item => new URL(item.url).pathname + new URL(item.url).search === evidenceUrl));
    const future = sidebar().locator('details.response-step').filter({ hasText: '현재 실행 세 번째 조치' });
    check(`${width} read-only future response reason starts collapsed`, await future.count() === 1 && await future.getAttribute('open') === null);
    await future.locator('summary').click();
    check(`${width} read-only future response reason can be inspected`, await future.getByText('합성 미래 단계 이유', { exact: true }).isVisible());
    await future.locator('summary').click();
    await tab('분석 자료·모델').click();
    check(`${width} materials evidence src and original link identify the analysis run`, await sidebar().locator('.evidence img').first().getAttribute('src') === evidenceUrl
      && await sidebar().locator('.evidence a').first().getAttribute('href') === evidenceUrl);
    await tab('대응').focus();
    for (const [key, expected] of [['ArrowRight', 'CCTV'], ['ArrowRight', '분석 자료·모델'], ['ArrowRight', '대응'], ['ArrowLeft', '분석 자료·모델'], ['Home', '대응'], ['End', '분석 자료·모델']]) {
      await page.keyboard.press(key); await selected(expected);
      check(`${width} ${key} focuses ${expected}`, await tab(expected).evaluate(node => node === document.activeElement));
    }
    await tab('CCTV').click(); await page.getByRole('button', { name: /타임라인 검증 신고 둘/ }).click(); await selected('대응');
    check(`${width} report switch resets default tab`, await tab('대응').getAttribute('aria-selected') === 'true');
    check(`${width} pinned report retains automatic button name`, await page.getByRole('button', { name: '자동', exact: true }).count() === 1);
    await page.getByRole('button', { name: '자동', exact: true }).click();
    await situation().locator('.display').filter({ hasText: '타임라인 검증 신고 하나' }).waitFor(); await tab('대응').click();
    check(`${width} live response remains read-only`, await sidebar().getByRole('button', { name: /실행 기록|^기록$/ }).count() === 0 && await sidebar().getByLabel('대응 메모').count() === 0);
    await layout(`${width} complete`); await page.screenshot({ path: `output/playwright/live-v2-${width}-complete.png` });
    const toggle = page.getByRole('button', { name: '전체 로그', exact: true });
    check(`${width} full log toggle initially unpressed`, await toggle.getAttribute('aria-pressed') === 'false'); await toggle.click();
    check(`${width} full log toggle pressed`, await page.getByRole('button', { name: '단계 보기', exact: true }).getAttribute('aria-pressed') === 'true');
    const lines = timeline().locator('.log-line').filter({ visible: true });
    const tags = await lines.locator('.log-tag').allTextContents();
    check(`${width} full log retains every tag and old runs`, ['RECEIVED', 'ATTACH', 'QUEUE', 'RERUN', 'CLASSIFY', 'CANDIDATES', 'SCAN', 'FOCUS', 'SUMMARY', 'EXPAND', 'VOICE', 'PHONE', 'WARN', 'DONE', 'LOG', 'REVIEW'].every(tag => tags.includes(tag))
      && tags.filter(tag => tag === 'QUEUE').length === 2 && tags.filter(tag => tag === 'DONE').length === 2 && (await lines.allTextContents()).join(' ').includes('전체 로그 보존 검증'), tags.join(','));
    check(`${width} full log chronological`, await lines.evaluateAll(nodes => {
      const times = nodes.map(node => node.textContent.match(/\d\d:\d\d:\d\d/)?.[0]).filter(Boolean);
      return times.every((time, i) => i === 0 || time >= times[i - 1]);
    }));
    await layout(`${width} all-log`); await page.screenshot({ path: `output/playwright/live-v2-${width}-all-log.png` });
    await page.getByRole('button', { name: '단계 보기', exact: true }).click();
    check(`${width} stage view restored`, await timeline().locator('li.timeline-stage').filter({ visible: true }).count() === 6);
    reset(); records[first].priority = 'urgent'; records[first].priority_basis = 'keywords';
    records[first].job = { ...records[first].job, state: 'queued', stage: 'awaiting_worker' }; records[first].events.push(event(30, 'analysis_requested', '대기 재분석', params));
    await visit(); await selected('대응'); check(`${width} urgent queued banner visible`, await page.locator('.urgent-banner').count() === 1);
    await layout(`${width} urgent`); await page.screenshot({ path: `output/playwright/live-v2-${width}-urgent.png` });
    reset(); records[first].analysis.search = { base_radius_m: 300, radius_m: 500, step_m: 100, expanded: true, attempts: [{ radius_m: 300, webcams: 0 }, { radius_m: 500, webcams: 3 }] };
    records[first].analysis.nearby = { ...nearby, radius_m: 500 }; records[first].analysis.outcome = 'VIDEO_NOT_VISIBLE'; records[first].job.stage = 'VIDEO_NOT_VISIBLE';
    records[first].analysis.cameras = []; records[first].analysis.selected_camera_ids = []; records[first].analysis.best_camera.video = null;
    await visit(); await tab('CCTV').click();
    await page.getByRole('region', { name: 'CCTV 안내 및 대응' }).getByText('반경 300m → 500m 자동 확대', { exact: true }).waitFor();
    await layout(`${width} expand`); await page.screenshot({ path: `output/playwright/live-v2-${width}-expand.png` });
    records = {}; await visit(); check(`${width} empty state explicit`, /신고.*없|신고.*기다/.test(await page.locator('main.wall').innerText()));
    await layout(`${width} empty`); await page.screenshot({ path: `output/playwright/live-v2-${width}-empty.png` });
    disconnected = true; await visit();
    await page.getByText(/연결.*끊|연결.*안 됨|연결.*확인/).filter({ visible: true }).first().waitFor({ timeout: 7000 });
    check(`${width} offline state explicit`, /연결.*끊|연결.*안 됨|연결.*확인/.test(await page.locator('main.wall').innerText()));
    await layout(`${width} offline`); await page.screenshot({ path: `output/playwright/live-v2-${width}-offline.png` }); disconnected = false;
  }
  for (const state of ['queued', 'running', 'failed']) {
    reset(); records[first].job = { ...records[first].job, state, stage: state === 'running' ? 'SCANNING' : state === 'failed' ? 'MANUAL_REVIEW_REQUIRED' : 'awaiting_worker', error: state === 'failed' ? '합성 실패' : null };
    records[first].events.push(event(30, 'analysis_requested', '새 재분석', params)); await visit(); await tab('분석 자료·모델').click();
    const shown = `${await sidebar().innerText()} ${await situation().innerText()} ${await timeline().innerText()}`;
    check(`${state} rerun hides stale evidence, model, transcript and next task`, !/고유한 현재 근거 후보|synthetic-yolo|합성 전사문|현재 실행 두 번째 조치/.test(shown) && await timeline().locator('.evidence img').count() === 0);
    check(`${state} rerun hides stale best camera`, !/cam-01/i.test(await situation().locator('.situation-camera').innerText()));
  }
  reset(); await visit(); await tab('분석 자료·모델').click();
  await sidebar().getByText('synthetic-yolo.pt', { exact: true }).waitFor();
  let releaseDetail;
  detailGate = new Promise(resolve => { releaseDetail = resolve; });
  records[first].job = { ...records[first].job, state: 'running', stage: 'SCANNING', progress: .5 };
  records[first].events.push(event(30, 'analysis_requested', '지연 상세 재분석', params));
  await situation().locator('.wall-outcome').filter({ hasText: '진행 중' }).waitFor();
  check('running snapshot hides the cached completed analysis while detail is delayed', await sidebar().locator('.evidence img').count() === 0
    && !(await sidebar().innerText()).includes('synthetic-yolo.pt') && !(await situation().innerText()).includes('현재 실행 두 번째 조치'));
  records[first] = detail(first, '타임라인 검증 신고 하나');
  records[first].events.push(event(30, 'analysis_requested', '새 실행 완료', params), event(40, 'analysis_finished', 'REVIEW_REQUIRED'));
  records[first].analysis.started_at = at(30); records[first].analysis.finished_at = at(40);
  await situation().locator('.wall-outcome').filter({ hasText: '관련 장면 후보' }).waitFor();
  check('completed snapshot keeps cached older analysis hidden until matching detail arrives', await sidebar().locator('.evidence img').count() === 0
    && !(await sidebar().innerText()).includes('synthetic-yolo.pt') && !(await situation().innerText()).includes('현재 실행 두 번째 조치'));
  detailGate = null; releaseDetail();
  await sidebar().getByText('synthetic-yolo.pt', { exact: true }).waitFor();
  const renewedUrl = `/api/b/api/v1/admin/reports/${first}/artifacts/focus/cam-01/evidence-01.jpg?run=${encodeURIComponent(at(30))}`;
  check('matching delayed detail restores evidence with the new run URL', await timeline().locator('.evidence img').first().getAttribute('src') === renewedUrl
    && await sidebar().locator('.evidence img').first().getAttribute('src') === renewedUrl);
  for (const candidates of [undefined, []]) {
    reset(); records[first].job = { ...records[first].job, state: 'failed', stage: 'MANUAL_REVIEW_REQUIRED', error: '합성 초기 실패' };
    records[first].analysis.outcome = 'MANUAL_REVIEW_REQUIRED'; records[first].analysis.cameras = [];
    records[first].analysis.candidates = candidates; records[first].analysis.selected_camera_ids = []; records[first].analysis.best_camera.video = null;
    await visit(); await tab('분석 자료·모델').click();
    const expected = candidates ? '반경 안 웹캠 없음' : '웹캠 후보를 확인하지 못했습니다.';
    await sidebar().getByText(expected, { exact: true }).waitFor();
    check(`early failure ${candidates ? 'known zero candidates' : 'unknown candidates'} uses accurate camera wording`, candidates
      ? await sidebar().getByText('반경 안 웹캠 없음', { exact: true }).count() === 1
      : await sidebar().getByText('반경 안 웹캠 없음', { exact: true }).count() === 0);
  }
  reset(); broken = true; await visit();
  await timeline().getByText('근거 이미지를 불러오지 못했습니다. 원본을 직접 확인하세요.', { exact: true }).first().waitFor({ timeout: 7000 });
  check('broken evidence has explicit fallback', await timeline().locator('.evidence').count() > 0 && await timeline().locator('.evidence img').count() === 0);
  check('read-only live tabs make no report writes', writes.length === 0, writes.join(','));
  check('no browser runtime errors', errors.length === 0, errors.join(' / '));
  if (results.some(result => result.startsWith('FAIL'))) throw new Error(results.join('\n'));
  return results.join('\n');
}
