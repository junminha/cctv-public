"""Real B HTTP process with A unconfigured; not an external CCTV verification."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time

import httpx


def test_uvicorn_factory_loads_local_settings_and_serves_authenticated_intake(tmp_path):
    root = Path(__file__).resolve().parents[1]
    configure = root / 'configure.py'
    # Check local credential generation without touching the user's actual credentials.
    local_setup = tmp_path / 'configure.py'
    local_setup.write_bytes(configure.read_bytes())
    first = subprocess.run([sys.executable, str(local_setup)], capture_output=True, check=True)
    credentials_path = tmp_path / 'runtime/secrets.json'
    before = credentials_path.read_bytes()
    subprocess.run([sys.executable, str(local_setup)], capture_output=True, check=True)
    assert credentials_path.read_bytes() == before
    identities = json.loads(before)['tokens']
    admin = next(token for token, identity in identities.items() if identity['role'] == 'admin')
    reporter = next(token for token, identity in identities.items() if identity['role'] == 'reporter')
    assert admin.encode() not in first.stdout
    assert reporter.encode() not in first.stdout
    with socket.socket() as port_probe:
        port_probe.bind(('127.0.0.1', 0))
        port = port_probe.getsockname()[1]
    environment = {key: value for key, value in os.environ.items()
                   if not key.startswith(('CCTV_B_', 'CCTV_ADAPTER_'))}
    environment.update(CCTV_B_SECRETS_FILE=str(credentials_path),
                       CCTV_B_DATABASE=str(tmp_path / 'http.sqlite3'),
                       CCTV_A_SECRETS_FILE=str(tmp_path / 'a-secrets.json'))
    process = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'server:application', '--factory',
                                '--app-dir', str(root), '--host', '127.0.0.1', '--port', str(port)],
                               env=environment, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                               creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    try:
        with httpx.Client(base_url=f'http://127.0.0.1:{port}', timeout=2, trust_env=False) as client:
            deadline = time.monotonic() + 15
            while True:
                try:
                    if client.get('/health').status_code == 200:
                        break
                except httpx.RequestError:
                    pass
                assert process.poll() is None, 'B server exited during startup'
                assert time.monotonic() < deadline, 'B server startup timed out'
                time.sleep(0.1)
            assert client.get('/api/v1/admin/reports').status_code == 401
            assert client.get('/openapi.json').json()['info']['title'] == 'CCTV B Central Server'
            response = client.post('/api/v1/reports', headers={'Authorization': 'Bearer ' + reporter},
                                   json={'description': '실제 HTTP 접수 검사', 'latitude': 37.5, 'longitude': 127.0})
            assert response.status_code == 201
            report_id = response.json()['report_id']
            status = client.get(f'/api/v1/reports/{report_id}/status',
                                headers={'Authorization': 'Bearer ' + reporter})
            assert status.json()['job']['state'] == 'queued'
            assert client.post('/api/v1/admin/agent/sync',
                               headers={'Authorization': 'Bearer ' + admin}).status_code == 503
    finally:
        process.terminate()
        try:
            process.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate(timeout=5)
