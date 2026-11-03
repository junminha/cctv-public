// Run from the repo root with a dedicated Playwright CLI session:
// npx --yes --package @playwright/cli playwright-cli -s=guidance open http://127.0.0.1:3000
// npx --yes --package @playwright/cli playwright-cli -s=guidance --raw run-code --filename=notebook-b/admin-web/tests/guidance-ui.js
// Synthetic responses only: no real credentials, uploads, report writes or camera access.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- Playwright CLI consumes this function expression.
async page => {
  const base = 'http://127.0.0.1:3000';
  const first = '11111111222233334444555566667777';
  const second = '8888888899990000aaaabbbbccccdddd';
  const at = '2026-10-23T07:00:00.000Z';
  const cameras = [{ id: 'cam-02', name: '검증 웹캠 2', online: true, recording: true, fresh: true, approved: true, demo_source: true,
    latitude: 35.23105, longitude: 129.08405, kind: 'demo', zone: '검증 구역', synced_at: at }];
  const publicCamera = { id: 'public-test', name: '검증용 사거리 CCTV', district: '테스트구', purpose: '생활방범',
    latitude: 35.23112, longitude: 129.08412, distance_m: 42, device_count: 2, place: '도로·교차로', score: .82,
    reasons: ['신고 지점에서 42m', '이름으로 본 장소: 도로·교차로 (사건 유형과 맞음)'] };
  const nearby = (radius = 100) => ({ radius_m: radius, center: { latitude: 35.231, longitude: 129.084 }, location_kind: 'demo',
    webcams: { total: 3, cameras: ['cam-01', 'cam-02', 'cam-03'].map((id, i) => ({ id, name: `검증 웹캠 ${i + 1}`,
      zone: '검증 구역', latitude: 35.231, longitude: 129.084, distance_m: 10 + i })) },
    public: { devices: radius === 200 ? 8 : 4, sites: radius === 200 ? 5 : 2, purposes: { '생활방범': 4 },
      places: { '도로·교차로': 2 }, recommended: [publicCamera], source: '검증용 공개 위치 자료', note: '공개 위치정보만 사용했습니다. 공공 CCTV 영상은 열람·분석하지 않습니다.' } });
  function detail(id, description) {
    return { report_id: id, description, source: 'demo', created_at: at, latitude: 35.231, longitude: 129.084,
      location_kind: 'demo', radius_m: 100, review: null, outcome: 'REVIEW_REQUIRED', selected_camera_ids: ['cam-02'], incident_type: 'FALL_SUSPECTED',
      job: { id: `job-${id}`, report_id: id, state: 'completed', stage: 'REVIEW_REQUIRED', progress: 1 }, details: '', occurred_at: null,
      owner: 'synthetic', attachments: [], events: [], analysis: { report_id: id, mode: 'selective',
        params: { mode: 'selective', source: 'live', duration: 10, sample_fps: 1, focus_fps: 3, top_k: 1 },
        started_at: at, finished_at: at, outcome: 'REVIEW_REQUIRED', cameras: [{ camera_id: 'cam-02', distance_m: 11, zone: '검증 구역',
          status: 'available', rank_score: .91, event_score: .7 }], selected_camera_ids: ['cam-02'], phone: [], warnings: [],
        nearby: nearby(), best_camera: { video: { camera_id: 'cam-02', name: '검증 웹캠 2', zone: '검증 구역',
          latitude: 35.231, longitude: 129.084, distance_m: 11, event_score: .7, reason: '영상 분석에서 관련 장면 후보: 누운 자세 후보' },
          public: id === first ? publicCamera : { ...publicCamera, name: '두 번째 위치 CCTV' }, note: '웹캠 영상에서 관련 장면 후보가 나온 카메라를 먼저 확인하세요.' },
        response_plan: { priority: 'urgent', priority_label: '긴급', source: 'local_rules',
          steps: [{ action: `${id === first ? '119 신고 여부 확인' : '두 번째 신고 조치 확인'}`, reason: '생명·신체 위험 우선' },
            { action: 'cam-02 근거 프레임 확인', reason: '자동 탐지 후보, 미확인' }], contacts: ['119', '테스트구 관제센터'],
          cautions: ['추천은 참고용입니다. 출동·조치 결정은 담당자가 합니다.', '시연 지점 기준 안내입니다.'] } } };
  }
  let records, scenario = 'normal', delayNearby = false;
  const reset = () => { records = { [first]: detail(first, '검증 신고 하나'), [second]: detail(second, '검증 신고 둘') }; };
  reset();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.context().addCookies([{ name: 'cctv_admin', value: 'synthetic-ui-check', domain: '127.0.0.1', path: '/' }]);
  await page.route('https://*.tile.openstreetmap.org/**', route => route.fulfill({ status: 204 }));
  await page.route('**/api/b/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/ws-ticket')) return route.fulfill({ json: { ticket: 'synthetic', expires_in: 30 } });
    if (path.endsWith('/admin/status')) return route.fulfill({ json: { ai_worker_available: true, worker_running: true,
      worker_enabled: true, vision: { device: 'cpu', models_present: true, loaded: true }, openai: { configured: false, model: '' }, adapter_configured: false } });
    if (path.endsWith('/public-cameras')) return route.fulfill({ json: { cameras: [], total: 0, source: {} } });
    const id = path.split('/reports/')[1]?.split('/')[0];
    if (!records[id]) return route.fulfill({ status: 404, json: {} });
    if (new URL(page.url()).pathname === '/live' && !['GET', 'HEAD'].includes(route.request().method())) {
      errors.push(`Read-only /live attempted a report write: ${route.request().method()} ${path}`);
      return route.abort();
    }
    if (path.endsWith('/nearby')) {
      if (delayNearby && id === first) await new Promise(resolve => setTimeout(resolve, 800));
      if (scenario === 'error') return route.fulfill({ status: 503, json: { detail: '안내 서비스 점검 중' } });
      const data = nearby(records[id].radius_m);
      if (id === second) data.public.recommended = [{ ...publicCamera, name: '두 번째 위치 CCTV' }];
      if (scenario === 'empty') { data.webcams = { total: 0, cameras: [] }; data.public = { ...data.public, devices: 0, sites: 0, purposes: {}, recommended: [] }; }
      return route.fulfill({ json: data });
    }
    if (path.endsWith('/radius')) { records[id].radius_m = route.request().postDataJSON().radius_m; return route.fulfill({ json: records[id] }); }
    if (path.endsWith('/clips')) return route.fulfill({ json: { clips: [] } });
    return route.fulfill({ json: records[id] });
  });
  await page.routeWebSocket('ws://127.0.0.1:8000/ws/v1/admin', ws => {
    ws.onMessage(() => ws.send(JSON.stringify({ type: 'snapshot', reports: Object.values(records), cameras, time: at, worker_running: true })));
  });
  const results = [];
  const guidance = () => page.getByRole('region', { name: 'CCTV 안내 및 대응' });
  const detailPanel = () => page.getByRole('complementary', { name: '신고 상세', exact: true });
  async function switchTab(path, name) {
    const list = path === '/' ? detailPanel().getByRole('tablist', { name: '신고 상세 탭' })
      : page.getByRole('tablist', { name: '분석 기록 탭' });
    await list.getByRole('tab', { name, exact: true }).click();
  }
  const responseArea = (path) => path === '/' ? detailPanel() : guidance();
  // /live v2 keeps the selected camera in the fixed situation card across sidebar tabs.
  const situation = (path) => path === '/' ? detailPanel() : page.getByRole('region', { name: '상황 카드', exact: true });
  const has = async (locator, text) => {
    await locator.getByText(text, { exact: false }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 7000 });
  };
  async function visit(path) {
    await page.goto(base + path);
    await page.getByRole('button', { name: /검증 신고 하나/ }).waitFor();
    if (path === '/') await page.getByRole('button', { name: /검증 신고 하나/ }).click();
    await switchTab(path, 'CCTV');
    await guidance().getByRole('heading', { name: /^반경 안 CCTV/ }).waitFor({ timeout: 5000 });
  }
  for (const width of [1920, 1366]) {
    await page.setViewportSize({ width, height: width === 1920 ? 1080 : 768 });
    for (const path of ['/', '/live']) {
      reset(); scenario = 'normal';
      await visit(path);
      await has(guidance(), 'CCTV 4대');
      await has(guidance(), '웹캠 영상 후보 3대');
      await switchTab(path, '대응');
      await has(responseArea(path), '긴급');
      await has(responseArea(path), '119 신고 여부 확인');
      await has(situation(path), '가장 적합한 CCTV');
      await has(situation(path), 'cam-02');
      if (path === '/live') {
        const writeControls = await guidance().locator('input, textarea, form').count() + await guidance().getByRole('button').count();
        results.push(`${writeControls === 0 ? 'PASS' : 'FAIL'} ${width} /live response remains read-only`);
      }
      if (path === '/') {
        const steps = guidance().locator('.guidance-steps > li');
        const futureControls = await steps.nth(1).locator('details, summary, button').count();
        results.push(`${futureControls === 0 ? 'PASS' : 'FAIL'} ${width} future unrecorded step is title only`);
        if (await steps.first().locator('details').getAttribute('open') === null) throw new Error('Current response step must be expanded');
      }
      if (path === '/') await detailPanel().locator('.panel-info > summary').click();
      await has(responseArea(path), '출동·조치 결정은 담당자가 합니다');
      await switchTab(path, 'CCTV');
      const disclosure = guidance().getByText('CCTV 추천 목록', { exact: true });
      if (path === '/live') await disclosure.click();
      await has(guidance(), '검증용 사거리 CCTV');
      if (path === '/') {
        const tableText = await guidance().locator('.guidance-table').innerText();
        if (/35\.23112|생활방범|이름으로 추정/.test(tableText)) throw new Error('Detailed public CCTV metadata remains in the concise recommendation table');
        await page.locator('.rec-pin').first().click();
        const popup = page.locator('.leaflet-popup-content');
        await has(popup, '35.23112');
        await has(popup, '생활방범');
        await has(popup, '이름으로 추정');
        await has(popup, '영상 미분석');
        await page.keyboard.press('Escape');
        const popupClose = page.locator('.leaflet-popup-close-button');
        if (await popupClose.count()) await popupClose.click();
        const info = detailPanel().locator('details').filter({ hasText: '공공 CCTV 영상은 열람·분석하지 않습니다' });
        if (await info.count() && await info.first().getAttribute('open') === null) await info.first().locator('summary').click();
        await has(detailPanel(), '공공 CCTV 영상은 열람·분석하지 않습니다');
      } else {
        await has(guidance(), '35.23112');
        await has(guidance(), '생활방범');
        await has(guidance(), '이름으로 추정');
        await has(guidance(), '공공 CCTV 영상은 열람·분석하지 않습니다');
      }
      await guidance().getByRole('heading', { name: /^반경 안 CCTV/ }).scrollIntoViewIfNeeded();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1);
      if (overflow) throw new Error(`Viewport overflow at ${width} ${path}`);
      await page.screenshot({ path: `output/playwright/guidance-${width}-${path === '/' ? 'report' : 'live'}.png` });
      await switchTab(path, '대응');
      await guidance().getByRole('heading', { name: /^대응 (방안 추천|단계)/ }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `output/playwright/guidance-response-${width}-${path === '/' ? 'report' : 'live'}.png` });
      results.push(`${width} ${path}: counts, recommendation, coordinates, purpose, response plan, viewport PASS`);
    }
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  reset(); scenario = 'normal';
  await visit('/');
  await has(guidance(), 'CCTV 4대');
  await switchTab('/', '도구');
  await detailPanel().locator('input[type=number]').first().fill('200');
  await switchTab('/', 'CCTV');
  await has(guidance(), 'CCTV 8대');
  await has(detailPanel(), /분석 당시 (기본 )?반경 100m/);
  results.push('Saved radius refresh and historical analysis label PASS');

  for (const path of ['/', '/live']) {
    reset(); scenario = 'empty';
    records[first].analysis = null;
    await visit(path);
    await has(guidance(), 'CCTV 0대');
    await has(guidance(), '반경 안 CCTV가 없습니다');
    await switchTab(path, '대응');
    await has(responseArea(path), '분석 완료 후');
    reset(); scenario = 'normal';
    delete records[first].analysis.nearby; delete records[first].analysis.best_camera; delete records[first].analysis.response_plan;
    await visit(path);
    await has(guidance(), 'CCTV 4대');
    await switchTab(path, '대응');
    await has(responseArea(path), '다시 분석');
    reset(); scenario = 'error';
    await visit(path);
    await has(guidance(), '안내 서비스 점검 중');
    scenario = 'normal';
    await guidance().getByRole('button', { name: '다시 불러오기' }).click();
    await has(guidance(), 'CCTV 4대');
    results.push(`${path}: empty, legacy and API error/retry PASS`);
  }
  reset(); scenario = 'normal'; delayNearby = true;
  await visit('/live');
  await page.getByRole('button', { name: /검증 신고 둘/ }).click();
  await switchTab('/live', '대응');
  await has(guidance(), '두 번째 신고 조치 확인');
  await switchTab('/live', 'CCTV');
  await guidance().getByText('CCTV 추천 목록', { exact: true }).click();
  await has(guidance(), '두 번째 위치 CCTV');
  await page.waitForTimeout(1000);
  if ((await guidance().innerText()).includes('검증용 사거리 CCTV')) throw new Error('Previous report nearby response leaked');
  await page.getByRole('button', { name: '자동', exact: true }).click();
  await switchTab('/live', '대응');
  await has(guidance(), '119 신고 여부 확인');
  delayNearby = false;
  reset();
  await visit('/');
  await page.locator('.score-tag').filter({ hasText: 'cam-02 0.91' }).waitFor({ state: 'visible' });
  records[first].job = { ...records[first].job, state: 'running', stage: 'SCANNING' };
  records[first].events = [{ type: 'analysis_requested', created_at: '2026-10-23T07:01:00.000Z', message: '분석 요청', data: {} }];
  for (const path of ['/', '/live']) {
    await visit(path);
    await has(guidance(), 'CCTV 4대');
    if (path === '/') results.push(`${await page.locator('.score-tag').count() === 0 ? 'PASS' : 'FAIL'} rerun removes previous map camera ranking`);
    await switchTab(path, '대응');
    if ((await responseArea(path).innerText()).includes('119 신고 여부 확인')) throw new Error('Previous run guidance shown during rerun');
  }
  records[first].job = { ...records[first].job, state: 'failed', stage: 'MANUAL_REVIEW_REQUIRED', error: 'B server restarted during analysis' };
  for (const path of ['/', '/live']) {
    await visit(path);
    await has(guidance(), 'CCTV 4대');
    await switchTab(path, '대응');
    if ((await responseArea(path).innerText()).includes('119 신고 여부 확인')) throw new Error(`Previous guidance reappeared after failed rerun on ${path}`);
  }
  records[first].analysis.started_at = '2026-10-23T07:02:00.000Z';
  records[first].analysis.finished_at = '2026-10-23T07:03:00.000Z';
  records[first].analysis.outcome = 'MANUAL_REVIEW_REQUIRED';
  for (const path of ['/', '/live']) {
    await visit(path);
    await switchTab(path, '대응');
    await has(responseArea(path), '119 신고 여부 확인');
  }
  // A saved report keeps its base radius while this analysis may use a wider search.
  const expansion = '반경 300m → 500m 자동 확대';
  const expanded = () => {
    records[first].radius_m = 300;
    records[first].analysis.nearby = nearby(500);
    records[first].analysis.search = { base_radius_m: 300, radius_m: 500, step_m: 100, expanded: true,
      attempts: [{ radius_m: 300, webcams: 0 }, { radius_m: 400, webcams: 0 }, { radius_m: 500, webcams: 3 }] };
    records[first].events = [{ type: 'radius_expanded', created_at: at, message: '검색 반경 자동 확대 300m → 500m', data: { from: 300, to: 500, webcams: 3 } }];
  };
  const check = (name, ok) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  for (const width of [1920, 1366]) {
    await page.setViewportSize({ width, height: width === 1920 ? 1080 : 768 });
    for (const path of ['/', '/live']) {
      reset(); scenario = 'normal'; expanded();
      await visit(path);
      const views = path === '/' ? ['CCTV', '대응'] : ['all'];
      for (const view of views) {
        await switchTab(path, view === 'all' ? 'CCTV' : view);
        const notice = guidance().getByText(expansion, { exact: true });
        check(`${width} ${path} ${view} shows this analysis expansion`, await notice.count() === 1 && await notice.isVisible());
        if (await notice.count()) {
          check(`${width} ${path} ${view} places expansion above guidance content`, await notice.evaluate(node =>
            node.parentElement.firstElementChild === node));
          await notice.scrollIntoViewIfNeeded();
        }
        check(`${width} ${path} ${view} auto expansion does not demand a radius rerun`, !(await responseArea(path).innerText()).includes('현재 반경과 다릅니다'));
        check(`${width} ${path} ${view} expansion preserves viewport`, await page.evaluate(() =>
          document.documentElement.scrollWidth <= innerWidth + 1 && document.documentElement.scrollHeight <= innerHeight + 1));
        await page.screenshot({ path: `output/playwright/expand-${width}-${path === '/' ? view === '대응' ? 'response' : 'cctv' : 'live'}.png` });
      }
      if (path === '/live') {
        const tag = page.locator('.log-line .log-tag').filter({ hasText: /^EXPAND$/ });
        check(`${width} /live logs radius expansion with EXPAND tag`, await tag.count() === 1);
        check(`${width} /live expansion log uses amber`, await tag.count() === 1 && await tag.evaluate(node => {
          const probe = document.createElement('span'); probe.style.color = 'var(--w-amber)'; node.appendChild(probe);
          const amber = getComputedStyle(probe).color; probe.remove(); return getComputedStyle(node).color === amber;
        }));
      }
    }
  }
  for (const path of ['/', '/live']) {
    for (const mode of ['legacy', 'unexpanded', 'queued', 'running', 'failed']) {
      reset(); expanded();
      if (mode === 'legacy') delete records[first].analysis.search;
      if (mode === 'unexpanded') records[first].analysis.search.expanded = false;
      if (mode === 'queued' || mode === 'running' || mode === 'failed') {
        records[first].job.state = mode;
        records[first].job.params = records[first].analysis.params;
        records[first].events.push({ type: 'analysis_requested', created_at: '2026-10-23T07:01:00.000Z', message: '분석 요청', data: {} });
      }
      await visit(path);
      await switchTab(path, '대응');
      check(`${path} ${mode} hides expansion notice`, await guidance().getByText(expansion, { exact: true }).count() === 0);
    }
    reset(); expanded();
    records[first].analysis.search.base_radius_m = 300.4;
    records[first].analysis.search.radius_m = 499.6;
    records[first].radius_m = 300.4;
    await visit(path);
    check(`${path} expansion notice rounds API radii`, await guidance().getByText(expansion, { exact: true }).count() === 1);
    reset(); expanded(); records[first].radius_m = 200;
    await visit(path);
    await switchTab(path, '대응');
    check(`${path} changed base radius still demands a rerun`, (await responseArea(path).innerText()).includes('현재 반경과 다릅니다'));
  }
  if (errors.length) throw new Error(errors.join('\n'));
  if (results.some(result => result.startsWith('FAIL'))) throw new Error(results.join('\n'));
  results.push('Delayed report switching, auto-follow, running/failed rerun freshness and fresh failure guidance PASS');
  return results.join('\n');
}
