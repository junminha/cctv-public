from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import re
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent


@dataclass(frozen=True)
class Settings:
    database_path: Path
    tokens: dict = field(repr=False)
    adapter_url: str = ''
    adapter_token: str = field(default='', repr=False)
    rtsp_user: str = field(default='', repr=False)
    rtsp_password: str = field(default='', repr=False)
    clips_dir: Path = ROOT / 'runtime/clips'


def load_settings():
    raw = os.environ.get('CCTV_B_TOKENS')
    try:
        if raw is not None:
            tokens = json.loads(raw)
        else:
            path = Path(os.environ.get('CCTV_B_SECRETS_FILE', str(ROOT / 'runtime/secrets.json')))
            tokens = json.loads(path.read_text(encoding='utf-8'))['tokens']
    except (OSError, ValueError, KeyError, TypeError):
        raise ValueError('B credentials are missing or invalid; run configure.py') from None
    if not isinstance(tokens, dict) or not tokens:
        raise ValueError('At least one B identity is required')
    for token, identity in tokens.items():
        if not isinstance(token, str) or re.fullmatch(r'[A-Za-z0-9_-]{32,}', token) is None:
            raise ValueError('B tokens must be at least 32 URL-safe characters')
        if (not isinstance(identity, dict) or identity.get('role') not in ('admin', 'reporter', 'agent')
                or not isinstance(identity.get('subject'), str) or not identity['subject'].strip()):
            raise ValueError('Every B identity needs a valid role and nonempty subject')

    a_path = Path(os.environ.get('CCTV_A_SECRETS_FILE', str(ROOT / 'runtime/a-secrets.json')))
    a_secrets = {}
    if a_path.exists():
        try:
            a_secrets = json.loads(a_path.read_text(encoding='utf-8-sig'))
            if not isinstance(a_secrets, dict) or any(not isinstance(a_secrets.get(key), str)
                    or not a_secrets[key] for key in ('token', 'rtsp_user', 'rtsp_password')):
                raise ValueError()
        except (OSError, ValueError, TypeError):
            raise ValueError('A credentials file is invalid; values suppressed') from None
    default_url = a_secrets.get('adapter_url', 'https://notebook-a.example.invalid') if a_secrets else ''
    url = os.environ.get('CCTV_ADAPTER_URL', default_url).rstrip('/')
    token = os.environ.get('CCTV_ADAPTER_TOKEN', a_secrets.get('token', ''))
    if bool(url) != bool(token):
        raise ValueError('Set both CCTV_ADAPTER_URL and CCTV_ADAPTER_TOKEN')
    if url:
        try:
            parts = urlsplit(url)
            port = parts.port
        except ValueError:
            raise ValueError('Invalid A Adapter URL') from None
        loopback = parts.hostname in ('127.0.0.1', 'localhost', '::1')
        if (not parts.hostname or parts.username is not None or parts.password is not None
                or parts.query or parts.fragment or parts.path
                or not (parts.scheme == 'https' or (parts.scheme == 'http' and loopback))
                or any(character.isspace() for character in url)
                or (port is not None and not 1 <= port <= 65535)):
            raise ValueError('A Adapter requires HTTPS (HTTP allowed only on loopback), without credentials or path')
        if not token.isascii() or any(character.isspace() for character in token):
            raise ValueError('Invalid A Adapter token format')
    return Settings(Path(os.environ.get('CCTV_B_DATABASE', str(ROOT / 'runtime/central.sqlite3'))),
                    tokens, url, token, a_secrets.get('rtsp_user', ''), a_secrets.get('rtsp_password', ''),
                    Path(os.environ.get('CCTV_B_CLIPS_DIR', str(ROOT / 'runtime/clips'))))
