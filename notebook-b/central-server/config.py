from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import re
from urllib.parse import urlsplit

from dotenv import dotenv_values

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
    openai_api_key: str = field(default='', repr=False)
    openai_model: str = 'gpt-6-luna'
    openai_transcription_model: str = 'gpt-transcribe'
    worker_enabled: bool = False
    auto_analyze: bool = True
    ai_device: str = 'auto'
    yolo_model: str = str(ROOT / 'runtime/models/yolo26n.pt')
    pose_model: str = str(ROOT / 'runtime/models/pose_landmarker_lite.task')
    attachments_dir: Path = ROOT / 'runtime/attachments'
    analysis_dir: Path = ROOT / 'runtime/analysis'
    admin_origins: tuple = ('http://localhost:3000', 'http://127.0.0.1:3000')


def environment():
    """Process environment overrides the local .env file; the file never mutates os.environ."""
    path = Path(os.environ.get('CCTV_B_ENV_FILE', str(ROOT / '.env')))
    values = {key: value for key, value in dotenv_values(path).items() if value is not None} if path.is_file() else {}
    return {**values, **os.environ}


def flag(value, name):
    lowered = value.strip().lower()
    if lowered in ('1', 'true', 'yes', 'on'):
        return True
    if lowered in ('0', 'false', 'no', 'off', ''):
        return False
    raise ValueError(f'{name} must be true or false')


def load_settings():
    env = environment()
    raw = env.get('CCTV_B_TOKENS')
    try:
        if raw is not None:
            tokens = json.loads(raw)
        else:
            path = Path(env.get('CCTV_B_SECRETS_FILE', str(ROOT / 'runtime/secrets.json')))
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

    a_path = Path(env.get('CCTV_A_SECRETS_FILE', str(ROOT / 'runtime/a-secrets.json')))
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
    url = env.get('CCTV_ADAPTER_URL', default_url).rstrip('/')
    token = env.get('CCTV_ADAPTER_TOKEN', a_secrets.get('token', ''))
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
    device = env.get('CCTV_AI_DEVICE', 'auto').strip().lower() or 'auto'
    if device not in ('auto', 'cuda', 'cpu'):
        raise ValueError('CCTV_AI_DEVICE must be auto, cuda or cpu')
    origins = tuple(origin.strip().rstrip('/') for origin in env.get(
        'CCTV_ADMIN_ORIGINS', ','.join(Settings.admin_origins)).split(',') if origin.strip())
    defaults = Settings(Path(), {})
    return Settings(Path(env.get('CCTV_B_DATABASE', str(ROOT / 'runtime/central.sqlite3'))),
                    tokens, url, token, a_secrets.get('rtsp_user', ''), a_secrets.get('rtsp_password', ''),
                    Path(env.get('CCTV_B_CLIPS_DIR', str(ROOT / 'runtime/clips'))),
                    openai_api_key=env.get('OPENAI_API_KEY', '').strip(),
                    openai_model=env.get('OPENAI_MODEL', '').strip() or defaults.openai_model,
                    openai_transcription_model=(env.get('OPENAI_TRANSCRIPTION_MODEL', '').strip()
                                                or defaults.openai_transcription_model),
                    worker_enabled=flag(env.get('CCTV_WORKER_ENABLED', 'false'), 'CCTV_WORKER_ENABLED'),
                    auto_analyze=flag(env.get('CCTV_AUTO_ANALYZE', 'true'), 'CCTV_AUTO_ANALYZE'),
                    ai_device=device,
                    yolo_model=env.get('CCTV_YOLO_MODEL', '').strip() or defaults.yolo_model,
                    pose_model=env.get('CCTV_POSE_MODEL', '').strip() or defaults.pose_model,
                    attachments_dir=Path(env.get('CCTV_B_ATTACHMENTS_DIR', str(defaults.attachments_dir))),
                    analysis_dir=Path(env.get('CCTV_B_ANALYSIS_DIR', str(defaults.analysis_dir))),
                    admin_origins=origins)
