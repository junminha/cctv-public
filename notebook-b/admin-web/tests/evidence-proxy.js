// Real Next proxy + a temporary synthetic upstream; never contacts the actual B or its data.
// Run after next build: node tests/evidence-proxy.js (from admin-web).
async function main() {
  const { createServer } = await import('node:http');
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const { resolve } = await import('node:path');
  const results = [], requests = [];
  const check = (name, ok) => { if (!ok) throw new Error(`FAIL ${name}`); results.push(`PASS ${name}`); };
  const token = 'synthetic-proxy-test';
  const body = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz');
  const modified = 'Mon, 26 Oct 2026 00:00:00 GMT';
  let releaseStream;
  const upstream = createServer(async (request, response) => {
    requests.push({ url: request.url, authorization: request.headers.authorization, cookie: request.headers.cookie,
      range: request.headers.range, ifRange: request.headers['if-range'], method: request.method });
    response.setHeader('Cache-Control', 'no-store, private');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Type', 'video/mp4');
    response.setHeader('Accept-Ranges', 'bytes');
    response.setHeader('ETag', '"synthetic-etag"');
    response.setHeader('Last-Modified', modified);
    response.setHeader('Content-Disposition', 'inline; filename="synthetic.mp4"');
    if (request.url.endsWith('/stream')) {
      response.setHeader('Content-Length', body.length);
      response.write(body.subarray(0, 10));
      await new Promise(resolve => { releaseStream = resolve; });
      response.end(body.subarray(10));
      return;
    }
    if (request.headers.range === 'bytes=999-') {
      response.writeHead(416, { 'Content-Range': `bytes */${body.length}` }); response.end(); return;
    }
    const partial = request.headers.range === 'bytes=0-9';
    if (partial) response.setHeader('Content-Range', `bytes 0-9/${body.length}`);
    response.setHeader('Content-Length', partial ? 10 : body.length);
    response.statusCode = partial ? 206 : 200;
    response.end(request.method === 'HEAD' ? undefined : partial ? body.subarray(0, 10) : body);
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'start', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: process.cwd(), env: { ...process.env, B_API_URL: `http://127.0.0.1:${upstream.address().port}` },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  // Consume startup output without printing environment/configuration diagnostics.
  child.stdout.resume(); child.stderr.resume();
  const base = `http://127.0.0.1:${port}`;
  const path = '/api/b/api/v1/admin/clips/synthetic/view';
  const headers = { Cookie: `cctv_admin=${token}` };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      try { if ((await fetch(base + '/login')).status === 200) { ready = true; break; } } catch { /* startup */ }
      if (child.exitCode !== null) throw new Error('Temporary Next proxy exited before readiness');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    check('temporary proxy is ready on an isolated port', ready);
    const unauthenticated = await fetch(base + path);
    check('proxy rejects unauthenticated media without upstream access', unauthenticated.status === 401 && requests.length === 0);
    check('proxy authentication errors prohibit caching', unauthenticated.headers.get('cache-control')?.includes('no-store'));
    const partial = await fetch(base + path + '?disposition=inline&analysis_started_at=synthetic', {
      headers: { ...headers, Range: 'bytes=0-9', 'If-Range': '"synthetic-etag"' },
    });
    check('range response remains 206 with the exact bytes', partial.status === 206 && Buffer.from(await partial.arrayBuffer()).equals(body.subarray(0, 10)));
    const sent = requests.at(-1);
    check('admin cookie becomes Authorization and is not forwarded as Cookie', sent.authorization === `Bearer ${token}` && sent.cookie === undefined);
    check('Range and If-Range reach the upstream unchanged', sent.range === 'bytes=0-9' && sent.ifRange === '"synthetic-etag"');
    check('query parameters reach the upstream', sent.url.endsWith('?disposition=inline&analysis_started_at=synthetic'));
    check('Content-Type Length and Range survive the proxy', partial.headers.get('content-type') === 'video/mp4' && partial.headers.get('content-length') === '10' && partial.headers.get('content-range') === `bytes 0-9/${body.length}`);
    check('validators and Accept-Ranges survive the proxy', partial.headers.get('etag') === '"synthetic-etag"' && partial.headers.get('last-modified') === modified && partial.headers.get('accept-ranges') === 'bytes');
    check('disposition and privacy headers survive the proxy', partial.headers.get('content-disposition')?.startsWith('inline;') && partial.headers.get('cache-control')?.includes('no-store') && partial.headers.get('x-content-type-options') === 'nosniff' && partial.headers.get('referrer-policy') === 'no-referrer');
    const head = await fetch(base + path, { method: 'HEAD', headers });
    check('HEAD reaches B with no response body', head.status === 200 && requests.at(-1).method === 'HEAD' && (await head.arrayBuffer()).byteLength === 0 && head.headers.get('content-length') === String(body.length));
    const invalid = await fetch(base + path, { headers: { ...headers, Range: 'bytes=999-' } });
    check('416 and unsatisfied Content-Range survive the proxy', invalid.status === 416 && invalid.headers.get('content-range') === `bytes */${body.length}`);
    const streamed = await fetch(base + '/api/b/api/v1/admin/clips/synthetic/stream', { headers });
    const reader = streamed.body.getReader();
    const first = await reader.read();
    check('stream body arrives before the upstream finishes', !first.done && first.value.length === 10);
    releaseStream();
    const rest = [];
    for (;;) { const part = await reader.read(); if (part.done) break; rest.push(Buffer.from(part.value)); }
    check('stream remainder is complete and unmodified', Buffer.concat([Buffer.from(first.value), ...rest]).equals(body));
    console.log(results.join('\n'));
  } finally {
    releaseStream?.();
    child.kill();
    await once(child, 'exit');
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
