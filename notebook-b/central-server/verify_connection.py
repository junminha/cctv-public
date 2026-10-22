"""Check A network/auth metadata only. Never decode or store CCTV frames."""
import json
import socket
from urllib.parse import urlsplit

import httpx

from adapter import Adapter, AdapterError
from config import ROOT, load_settings
from models import utc


def main():
    settings = load_settings()
    if not settings.adapter_url or not settings.adapter_token:
        raise SystemExit('A connection is not configured; provide runtime/a-secrets.json')
    parsed = urlsplit(settings.adapter_url)
    result = {'checked_at': utc(), 'checks': {}, 'video_decode': 'NOT_TESTED',
              'analysis_approval': 'UNREGISTERED', 'footage_saved': False}
    for port in (parsed.port or 443, 8555):
        try:
            with socket.create_connection((parsed.hostname, port), timeout=8):
                result['checks'][f'tcp_{port}'] = 'reachable'
        except OSError:
            result['checks'][f'tcp_{port}'] = 'unreachable'
    with httpx.Client(timeout=10, follow_redirects=False, trust_env=False) as http:
        agent = Adapter(settings, http)
        try:
            result['checks']['unauthenticated_health_http'] = http.get(
                settings.adapter_url + '/agent/v1/health').status_code
        except httpx.RequestError:
            result['checks']['unauthenticated_health_http'] = 'unreachable'
        for name in ('health', 'cameras'):
            try:
                value = getattr(agent, name)()
                result['checks'][name] = 'passed'
                if name == 'cameras':
                    result['cameras'] = [{key: getattr(camera, key) for key in ('id', 'online', 'recording')}
                                         for camera in value]
            except AdapterError as exc:
                result['checks'][name] = {'status': exc.status, 'detail': exc.message}
    receipt = ROOT / 'runtime/connection.json'
    receipt.parent.mkdir(parents=True, exist_ok=True)
    receipt.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
