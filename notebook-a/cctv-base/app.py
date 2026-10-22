"""Independent Windows CCTV recorder. Python standard library only."""
import datetime as dt
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import threading
import time
import urllib.request
import urllib.error
from urllib.parse import urlencode, urlsplit, parse_qs
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parent
RUNTIME = ROOT / 'runtime'
RECORDINGS = ROOT / 'recordings'
NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)

def camera_id(value, cameras):
    if value not in {c['id'] for c in cameras}:
        raise ValueError('Unknown camera')
    return value

def utc_time(value):
    parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('Timezone required')
    return parsed.astimezone(dt.timezone.utc).isoformat().replace('+00:00', 'Z')

def duration(value):
    result = float(value)
    if not math.isfinite(result) or not 0 < result <= 3600:
        raise ValueError('Duration must be 0 < seconds <= 3600')
    return result

def ordered_times(start, end):
    return dt.datetime.fromisoformat(utc_time(start)) < dt.datetime.fromisoformat(utc_time(end))

def recording_evidence(folder):
    # Check completed/visible bytes, not merely whether RTSP is connected.
    latest = None
    for path in folder.glob('*.mp4'):
        try:
            info = path.stat()
            if info.st_size > 0 and time.time() - info.st_mtime < 125:
                latest = max(latest or 0, info.st_mtime)
        except OSError: continue
    return latest

def tool(name):
    return next((ROOT / 'tools').rglob(name + '.exe'))

def upstream(port, path, data=None):
    req = urllib.request.Request(f'http://127.0.0.1:{port}{path}', data=data,
                                 headers={'Content-Type': 'application/json'})
    return urllib.request.urlopen(req, timeout=30)

def recordings(camera, start=None, end=None):
    query = {'path': camera}
    if start: query['start'] = utc_time(start)
    if end: query['end'] = utc_time(end)
    if start and end and not ordered_times(start, end):
        raise ValueError('Start must precede end')
    with upstream(9996, '/list?' + urlencode(query)) as response:
        rows = json.load(response)
    return [{'start': utc_time(r['start']), 'duration': r['duration']} for r in rows]

class Recorder:
    def __init__(self):
        self.cameras = json.loads((ROOT / 'cameras.json').read_text(encoding='utf-8-sig'))
        self.children = {}
        self.restarts = {}
        self.stop_event = threading.Event()
        self.disk_low = False
        self.min_free_gb = float(os.environ.get('CCTV_MIN_FREE_GB', '10'))
        self.fatal_error = None
        self.failure_callback = None
        from windows_job import Job
        self.job = Job()
        self.started = dt.datetime.now(dt.timezone.utc).isoformat()
        RUNTIME.mkdir(exist_ok=True)
        RECORDINGS.mkdir(exist_ok=True)
        (ROOT / 'logs').mkdir(exist_ok=True)

    def spawn(self, key, args):
        with (ROOT / 'logs' / f'{key}.log').open('ab') as log:
            p = subprocess.Popen([str(x) for x in args], cwd=ROOT, stdin=subprocess.PIPE,
                                 stdout=log, stderr=log, creationflags=NO_WINDOW,
                                 env={**os.environ, 'TZ': 'UTC'})
        self.children[key] = p
        self.job.add(p)
        self.restarts[key] = self.restarts.get(key, -1) + 1
        return p

    def config(self):
        paths = '\n'.join('  ' + c['id'] + ': {}' for c in self.cameras)
        text = '''logLevel: info
api: true
apiAddress: 127.0.0.1:9997
playback: true
playbackAddress: 127.0.0.1:9996
rtspAddress: 127.0.0.1:8554
rtspTransports: [tcp]
rtmp: false
srt: false
webrtc: false
hls: true
hlsAddress: 127.0.0.1:8888
hlsAlwaysRemux: true
authInternalUsers:
  - user: any
    ips: [127.0.0.1, '::1']
    permissions:
      - action: publish
      - action: read
      - action: playback
      - action: api
pathDefaults:
  record: true
  recordPath: ./recordings/%path/%Y-%m-%d_%H-%M-%S-%f%z
  recordFormat: fmp4
  recordPartDuration: 1s
  recordSegmentDuration: 60s
  recordDeleteAfter: 168h
paths:
''' + paths + '\n'
        (ROOT / 'mediamtx.generated.yml').write_text(text, encoding='utf-8')

    def capture(self, camera):
        args = [tool('ffmpeg'), '-hide_banner', '-loglevel', 'warning', '-nostats',
                '-thread_queue_size', '64', '-f', 'dshow', '-rtbufsize', '64M',
                '-video_size', camera.get('size', '1280x720'),
                '-framerate', str(camera.get('capture_fps', 15))]
        if camera.get('input_format'):
            args += ['-vcodec', camera['input_format']]
        args += ['-i', 'video=' + camera['device'], '-an', '-vf', 'fps=10,format=yuv420p',
                 '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
                 '-threads', '2', '-b:v', '1500k', '-maxrate', '1500k', '-bufsize', '3000k',
                 '-g', '20', '-keyint_min', '20', '-sc_threshold', '0',
                 '-f', 'rtsp', '-rtsp_transport', 'tcp',
                 'rtsp://127.0.0.1:8554/' + camera['id']]
        self.spawn(camera['id'], args)

    def run(self):
        self.config()
        self.spawn('mediamtx', [tool('mediamtx'), ROOT / 'mediamtx.generated.yml'])
        self.stop_event.wait(2)
        while not self.stop_event.wait(3):
            self.disk_low = shutil.disk_usage(RECORDINGS).free < self.min_free_gb * 1024**3
            if self.disk_low:
                for c in self.cameras: self.stop_child(c['id'])
                continue
            if self.children['mediamtx'].poll() is not None:
                self.spawn('mediamtx', [tool('mediamtx'), ROOT / 'mediamtx.generated.yml'])
                self.stop_event.wait(2)
            for c in self.cameras:
                if self.stop_event.is_set(): return
                child = self.children.get(c['id'])
                if child is None or child.poll() is not None: self.capture(c)

    def supervise(self):
        try: self.run()
        except Exception as exc:
            self.fatal_error = str(exc)
            self.close()
            import traceback
            traceback.print_exc()
            if self.failure_callback: self.failure_callback()

    def stop_child(self, key):
        p = self.children.get(key)
        if p and p.poll() is None:
            try:
                if key != 'mediamtx':
                    p.stdin.write(b'q\n'); p.stdin.flush(); p.wait(8)
                else: p.terminate(); p.wait(5)
            except (OSError, subprocess.TimeoutExpired):
                p.kill(); p.wait()

    def close(self):
        self.stop_event.set()
        for c in self.cameras: self.stop_child(c['id'])
        self.stop_child('mediamtx')

    def status(self):
        try:
            with upstream(9997, '/v3/paths/list') as response:
                paths = {p['name']: p for p in json.load(response)['items']}
        except (OSError, ValueError): paths = {}
        cams = []
        for c in self.cameras:
            p = paths.get(c['id'], {})
            evidence = recording_evidence(RECORDINGS / c['id'])
            cams.append({'id': c['id'], 'name': c['name'], 'online': p.get('ready', False),
                         'bytes_received': p.get('bytesReceived', 0),
                         'restarts': self.restarts.get(c['id'], 0),
                         'recording': bool(p.get('ready')) and not self.disk_low and evidence is not None,
                         'last_verified_recording': dt.datetime.fromtimestamp(evidence, dt.timezone.utc).isoformat() if evidence else None})
        return {'started': self.started, 'time': dt.datetime.now(dt.timezone.utc).isoformat(),
                'disk_free_gb': round(shutil.disk_usage(RECORDINGS).free / 1024**3, 2),
                'disk_low': self.disk_low, 'retention_days': 7,
                'fatal_error': self.fatal_error, 'cameras': cams}

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass

    def do_POST(self):
        if (self.path != '/api/shutdown' or
            self.headers.get('Host') != '127.0.0.1:8765' or
            self.headers.get('Origin') != 'http://127.0.0.1:8765'):
            return self.json({'error': 'Forbidden'}, 403)
        self.json({'stopping': True})
        threading.Thread(target=self.server.shutdown, daemon=True).start()

    def json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status); self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)

    def do_GET(self):
        # Refuse cross-origin requests/DNS rebinding against this loopback-only control service.
        host = self.headers.get('Host', '').split(':')[0]
        if host not in ('127.0.0.1', 'localhost'):
            return self.json({'error': 'Invalid host'}, 403)
        url = urlsplit(self.path); query = {k: v[0] for k,v in parse_qs(url.query).items()}
        try:
            if url.path == '/':
                body = (ROOT / 'index.html').read_bytes()
                self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
            elif url.path == '/api/status': self.json(self.server.recorder.status())
            elif url.path == '/api/recordings':
                camera = camera_id(query.get('camera'), self.server.recorder.cameras)
                self.json(recordings(camera, query.get('start'), query.get('end')))
            elif url.path == '/api/playback':
                camera = camera_id(query.get('camera'), self.server.recorder.cameras)
                params = {'path': camera, 'start': utc_time(query['start']),
                          'duration': duration(query['duration']), 'format': 'mp4'}
                with upstream(9996, '/get?' + urlencode(params)) as response:
                    self.send_response(200); self.send_header('Content-Type', 'video/mp4')
                    if response.headers.get('Content-Length'):
                        self.send_header('Content-Length', response.headers['Content-Length'])
                    self.end_headers(); shutil.copyfileobj(response, self.wfile)
            else: self.json({'error': 'Not found'}, 404)
        except (ValueError, KeyError) as exc: self.json({'error': str(exc)}, 400)
        except urllib.error.HTTPError as exc: self.json({'error': 'Recording unavailable'}, exc.code)
        except (OSError, TimeoutError):
            try: self.json({'error': 'Media service unavailable'}, 503)
            except OSError: pass

def main():
    # Bind before launching children: a second launch cannot start duplicate recorders.
    server = ThreadingHTTPServer(('127.0.0.1', 8765), Handler)
    recorder = Recorder(); server.recorder = recorder
    recorder.failure_callback = server.shutdown
    (RUNTIME / 'base.pid').write_text(str(os.getpid()))
    thread = threading.Thread(target=recorder.supervise, daemon=True); thread.start()
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally:
        recorder.close(); server.server_close()
        (RUNTIME / 'base.pid').unlink(missing_ok=True)
    if recorder.fatal_error: raise SystemExit(1)

if __name__ == '__main__': main()
