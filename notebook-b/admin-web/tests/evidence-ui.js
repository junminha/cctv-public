// Synthetic evidence only. No credentials, real files, uploads or camera access.
// npx --yes --package @playwright/cli playwright-cli -s=evidence-ui open http://127.0.0.1:3000
// npx --yes --package @playwright/cli playwright-cli -s=evidence-ui --raw run-code --filename=notebook-b/admin-web/tests/evidence-ui.js
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- Playwright CLI consumes this function.
async page => {
  const at = '2026-10-26T00:00:00Z';
  const first = '11111111222233334444555566667777', second = '8888888899990000aaaabbbbccccdddd';
  const sha = 'a'.repeat(64), current = 'b'.repeat(64), requests = [], errors = [], results = [];
  const check = (name, ok) => results.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  const make = (id, kind, category, extra = {}) => ({ id, category, kind, label: `검증 ${id}`, representation: category === 'artifact' ? 'analysis_overlay' : category === 'clip' ? 'remux_copy' : 'upload_original',
    content_type: kind === 'image' ? 'image/png' : kind === 'video' ? 'video/mp4' : 'audio/wav', bytes: 128, stored_at: at, captured_at: null,
    timestamp_seconds: category === 'artifact' ? 2 : null, recorded_sha256: sha, current_sha256: null, integrity: 'unknown', available: true,
    view_url: `/api/v1/admin/reports/${first}/test-media/${id}`, download_url: `/api/v1/admin/reports/${first}/test-download/${id}`,
    thumbnail_url: kind === 'audio' ? null : `/api/v1/admin/reports/${first}/test-thumb/${id}`, analysis_started_at: category === 'artifact' ? at : null, ...extra });
  const items = [make('photo', 'image', 'attachment', { attachment_id: 'photo' }), make('audio', 'audio', 'attachment', { attachment_id: 'audio' }),
    make('video', 'video', 'attachment', { attachment_id: 'video' }), ...['scan', 'focus', 'all', 'phone', 'focus', 'scan'].map((kind, i) => make(`frame-${i}`, 'image', 'artifact', { artifact_kind: kind, camera_id: kind === 'phone' ? null : 'cam-02' })),
    make('clip', 'video', 'clip', { clip_id: 'clip', camera_id: 'cam-02' })];
  const records = Object.fromEntries([first, second].map((id, i) => [id, { report_id: id, description: `증거 검증 신고 ${i + 1}`, source: 'demo', created_at: at, latitude: 35.231, longitude: 129.084,
    location_kind: 'demo', radius_m: 100, review: null, outcome: 'REVIEW_REQUIRED', selected_camera_ids: ['cam-02'], incident_type: 'FALL_SUSPECTED',
    job: { id: `job-${id}`, report_id: id, state: 'completed', stage: 'REVIEW_REQUIRED', progress: 1 }, details: '', occurred_at: null, owner: 'synthetic',
    attachments: i ? [] : items.filter(item => item.category === 'attachment').map(item => ({ attachment_id: item.id, kind: item.kind, content_type: item.content_type,
      bytes: item.bytes, sha256: sha, original_name: item.label, created_at: at, download_path: item.download_url })), events: [],
    analysis: { report_id: id, mode: 'selective', params: { mode: 'selective', source: 'live', duration: 10, sample_fps: 1, focus_fps: 3, top_k: 1 }, started_at: at,
      outcome: 'REVIEW_REQUIRED', cameras: [], selected_camera_ids: [], phone: [], warnings: [] } }]));
  const nearby = { radius_m: 100, center: { latitude: 35.231, longitude: 129.084 }, location_kind: 'demo', webcams: { total: 0, cameras: [] },
    public: { devices: 0, sites: 0, purposes: {}, places: {}, recommended: [], source: 'synthetic', note: '공공 CCTV 위치만' } };
  let catalogError = false;
  page.on('pageerror', error => errors.push(String(error)));
  await page.context().addCookies([{ name: 'cctv_admin', value: 'synthetic-ui-check', domain: '127.0.0.1', path: '/' }]);
  await page.route('https://*.tile.openstreetmap.org/**', route => route.fulfill({ status: 204 }));
  await page.route('**/api/b/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    requests.push(path + url.search);
    if (path.endsWith('/ws-ticket')) return route.fulfill({ json: { ticket: 'synthetic', expires_in: 30 } });
    if (path.endsWith('/admin/status')) return route.fulfill({ json: { ai_worker_available: true, worker_running: true, vision: {}, openai: {} } });
    if (path.endsWith('/public-cameras')) return route.fulfill({ json: { cameras: [], total: 0, source: {} } });
    const id = path.split('/reports/')[1]?.split('/')[0];
    if (!records[id]) return route.fulfill({ status: 404, json: {} });
    if (path.endsWith('/nearby')) return route.fulfill({ json: nearby });
    if (path.endsWith('/clips')) return route.fulfill({ json: { clips: [{ clip_id: 'clip', camera_id: 'cam-02', start: at, requested_duration: 10,
      measured_duration: 9, duration_matches_request: false, sha256: sha, bytes: 128, created_at: at, download_path: items.at(-1).download_url }] } });
    if (path.endsWith('/evidence')) return route.fulfill(catalogError ? { status: 503, json: { detail: '자료 목록 점검 중' } } : { json: { items: id === first ? items : [], analysis_started_at: at, warnings: [] } });
    if (path.includes('/evidence/')) { const item = items.find(item => item.id === path.split('/').at(-1)); return route.fulfill({ json: { ...item, current_sha256: current, integrity: 'mismatch' } }); }
    if (path.endsWith('/manifest.json')) return route.fulfill({ json: { generated_at: at, includes_media: url.searchParams.get('media') !== 'false', files: [{ path: 'attachments/photo.png', bytes: 128, sha256: sha, matches_recorded_sha256: false }], missing: ['clips/missing.mp4'] } });
    if (path.includes('/test-thumb/video')) return route.fulfill({ status: 503, json: { detail: '미리보기 불가' } });
    if (path.includes('/test-thumb/') || path.endsWith('/test-media/photo') || path.includes('/test-media/frame-')) return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') });
    if (path.includes('/test-media/')) return route.fulfill({ status: 409, json: { detail: '무결성 검증 불일치' } });
    return route.fulfill({ json: records[id] });
  });
  await page.routeWebSocket('ws://127.0.0.1:8000/ws/v1/admin', ws => ws.onMessage(() => ws.send(JSON.stringify({ type: 'snapshot', reports: Object.values(records), cameras: [], time: at, worker_running: true }))));
  await page.goto('http://127.0.0.1:3000/');
  await page.getByRole('button', { name: /증거 검증 신고 1/ }).click();
  const panel = page.getByRole('complementary', { name: '신고 상세', exact: true });
  const tab = name => panel.getByRole('tab', { name, exact: true });
  await tab('신고 내용').click();
  await page.waitForTimeout(500);
  const gallery = panel.getByRole('list', { name: '신고자 첨부 자료' });
  check('attachment gallery exists', await gallery.count() === 1);
  if (!(await gallery.count())) return results.join('\n'); // RED on the previous build.
  check('all three attachment kinds appear', await gallery.locator('li').count() === 3);
  check('no original preload before opening', !requests.some(path => path.includes('/test-media/')));
  check('hash is not verified while listing', !requests.some(path => path.includes('verify=true')));
  await gallery.getByRole('button', { name: '검증 photo 크게 보기', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '증거 자료 보기', exact: true });
  await dialog.waitFor();
  check('native modal opens', await dialog.evaluate(el => el.matches(':modal')));
  check('upload classification and unknown capture time', (await dialog.textContent()).includes('신고자 업로드 원본') && (await dialog.textContent()).includes('촬영 시각 미확인'));
  check('full recorded hash visible', (await dialog.textContent()).includes(sha));
  await dialog.getByRole('button', { name: '해시 검증', exact: true }).click();
  await dialog.getByText(current, { exact: true }).waitFor();
  check('explicit verification shows current full hash and mismatch', requests.some(path => path.includes('verify=true')) && (await dialog.textContent()).includes('불일치'));
  await dialog.getByRole('button', { name: '확대', exact: true }).click();
  check('zoom changes image viewport', await dialog.locator('.evidence-image-stage').getAttribute('data-zoom') !== 'fit');
  await dialog.getByRole('button', { name: '맞춤', exact: true }).click();
  check('fit resets zoom', await dialog.locator('.evidence-image-stage').getAttribute('data-zoom') === 'fit');
  await dialog.getByRole('button', { name: '닫기', exact: true }).focus();
  await page.keyboard.press('End');
  check('End navigates to final attachment', (await dialog.textContent()).includes('검증 video'));
  check('video does not autoplay', await dialog.locator('video').evaluate(el => !el.autoplay && el.paused));
  await dialog.locator('video').focus();
  await page.keyboard.press('Home');
  check('media keyboard remains native', (await dialog.textContent()).includes('검증 video'));
  await dialog.getByRole('button', { name: '닫기', exact: true }).focus();
  await page.keyboard.press('Home');
  check('Home returns to first attachment', (await dialog.textContent()).includes('검증 photo'));
  await page.keyboard.press('Escape');
  check('Esc closes and returns focus', !(await dialog.count()) && await gallery.getByRole('button', { name: '검증 photo 크게 보기', exact: true }).evaluate(el => document.activeElement === el));
  await gallery.getByRole('button', { name: '검증 audio 재생', exact: true }).click();
  check('audio does not autoplay', await dialog.locator('audio').evaluate(el => !el.autoplay && el.paused && el.preload === 'none'));
  await dialog.getByRole('button', { name: '닫기', exact: true }).click();
  check('media detached on close', await page.locator('dialog audio, dialog video').count() === 0);
  await tab('CCTV').click();
  await panel.locator('.all-evidence summary').click();
  const frames = panel.getByRole('list', { name: '분석 근거 자료' });
  check('all scan focus all phone frames appear without four limit', await frames.locator('li').count() === 6 && (await frames.textContent()).includes('phone'));
  await frames.getByRole('button', { name: '검증 frame-0 크게 보기', exact: true }).click();
  check('analysis source is clear', (await dialog.textContent()).includes('AI 표시가 포함된 분석본'));
  await dialog.getByRole('button', { name: '닫기', exact: true }).click();
  await tab('분석·보관').click();
  check('preserve mismatch remains visible', (await panel.textContent()).includes('길이 불일치'));
  check('preserved clip has playback and file info', await panel.getByRole('list', { name: '보존 영상 자료' }).getByRole('button').count() >= 2);
  check('existing ZIP download retained', await panel.getByRole('link', { name: '증거 묶음 다운로드 (ZIP)' }).count() === 1);
  check('preserved clip download link', await panel.getByRole('list', { name: '보존 영상 자료' }).getByRole('link', { name: '다운로드' }).count() === 1);
  for (const [width, height] of [[1366, 768], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await tab('신고 내용').click();
    await gallery.getByRole('button', { name: '검증 photo 크게 보기', exact: true }).click();
    check(`${width} modal fits viewport`, await dialog.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }));
    await page.screenshot({ path: `output/playwright/evidence-${width}.png` });
    await dialog.getByRole('button', { name: '닫기', exact: true }).click();
  }
  await page.getByRole('button', { name: /증거 검증 신고 2/ }).click();
  await tab('신고 내용').click();
  check('report switch removes prior evidence', !(await panel.textContent()).includes('검증 photo'));
  catalogError = true;
  await page.getByRole('button', { name: /증거 검증 신고 1/ }).click();
  await tab('신고 내용').click();
  await panel.getByText('자료 목록 점검 중', { exact: true }).waitFor();
  check('catalog errors are readable with retry', await panel.getByRole('button', { name: '자료 다시 불러오기' }).count() === 1);
  const count = requests.filter(path => path.endsWith('/evidence')).length;
  await page.goto('http://127.0.0.1:3000/live');
  await page.waitForTimeout(700);
  check('/live does not load evidence catalog', requests.filter(path => path.endsWith('/evidence')).length === count);
  check('no page errors', errors.length === 0);
  return results.join('\n');
}
