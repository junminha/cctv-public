from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent


@dataclass(frozen=True)
class Settings:
    database_path: Path
    tokens: dict
    adapter_url: str = ''
    adapter_token: str = ''


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

    url = os.environ.get('CCTV_ADAPTER_URL', '').rstrip('/')
    token = os.environ.get('CCTV_ADAPTER_TOKEN', '')
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
                    tokens, url, token)
