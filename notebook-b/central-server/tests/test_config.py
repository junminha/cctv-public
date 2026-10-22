import json

import pytest

from config import load_settings

TOKEN = 'local-config-test-' + 'x' * 32


@pytest.fixture
def config_env(monkeypatch, tmp_path):
    for key in ('CCTV_B_TOKENS', 'CCTV_ADAPTER_URL', 'CCTV_ADAPTER_TOKEN', 'CCTV_B_DATABASE',
                'OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_TRANSCRIPTION_MODEL', 'CCTV_WORKER_ENABLED',
                'CCTV_AI_DEVICE', 'CCTV_YOLO_MODEL', 'CCTV_POSE_MODEL', 'CCTV_AUTO_ANALYZE'):
        monkeypatch.delenv(key, raising=False)
    # Never read the operator's real .env during tests.
    monkeypatch.setenv('CCTV_B_ENV_FILE', str(tmp_path / '.env'))
    path = tmp_path / 'secrets.json'
    path.write_text(json.dumps({'tokens': {TOKEN: {'role': 'admin', 'subject': 'operator'}}}))
    monkeypatch.setenv('CCTV_B_SECRETS_FILE', str(path))
    monkeypatch.setenv('CCTV_A_SECRETS_FILE', str(tmp_path / 'a-secrets.json'))
    return path


def test_load_local_secrets_and_use_explicit_database_path(config_env, monkeypatch, tmp_path):
    monkeypatch.setenv('CCTV_B_DATABASE', str(tmp_path / 'db.sqlite3'))
    settings = load_settings()
    assert settings.tokens[TOKEN] == {'role': 'admin', 'subject': 'operator'}
    assert settings.database_path == tmp_path / 'db.sqlite3'
    assert settings.adapter_url == ''


@pytest.mark.parametrize('identities', [
    {}, {'short': {'role': 'admin', 'subject': 'operator'}},
    {TOKEN: {'role': 'root', 'subject': 'operator'}},
    {TOKEN: {'role': 'reporter', 'subject': '   '}},
    {TOKEN: {'role': 'admin'}},
])
def test_invalid_identities_fail_closed(config_env, monkeypatch, identities):
    monkeypatch.setenv('CCTV_B_TOKENS', json.dumps(identities))
    with pytest.raises(ValueError):
        load_settings()


@pytest.mark.parametrize('url', [
    'http://remote.example', 'https://user:password@a.example',
    'https://a.example?token=secret', 'https://a.example/#token',
    'file:///tmp/local', 'https://a.example/path',
])
def test_unsafe_adapter_urls_are_rejected(config_env, monkeypatch, url):
    monkeypatch.setenv('CCTV_ADAPTER_URL', url)
    monkeypatch.setenv('CCTV_ADAPTER_TOKEN', 'adapter-test')
    with pytest.raises(ValueError):
        load_settings()


@pytest.mark.parametrize('url', ['https://a.example', 'http://127.0.0.1:8766', 'http://localhost:8766'])
def test_https_or_explicit_loopback_adapter_is_supported(config_env, monkeypatch, url):
    monkeypatch.setenv('CCTV_ADAPTER_URL', url)
    monkeypatch.setenv('CCTV_ADAPTER_TOKEN', 'adapter-test')
    assert load_settings().adapter_url == url


def test_missing_secrets_and_partial_adapter_configuration_fail_closed(config_env, monkeypatch):
    config_env.unlink()
    with pytest.raises(ValueError):
        load_settings()
    monkeypatch.setenv('CCTV_B_TOKENS', json.dumps({TOKEN: {'role': 'admin', 'subject': 'operator'}}))
    monkeypatch.setenv('CCTV_ADAPTER_URL', 'https://a.example')
    with pytest.raises(ValueError):
        load_settings()


def test_a_secret_file_is_loaded_without_changing_b_identities(config_env, monkeypatch):
    path = config_env.parent / 'a-secrets.json'
    path.write_text(json.dumps({'token': 'a-token-for-test', 'rtsp_user': 'reader',
                                'rtsp_password': 'private-test-password'}), encoding='utf-8-sig')
    settings = load_settings()
    assert settings.adapter_url == 'https://notebook-a.example.invalid'
    assert settings.adapter_token == 'a-token-for-test'
    assert settings.rtsp_user == 'reader'
    assert settings.rtsp_password == 'private-test-password'
    assert settings.tokens[TOKEN]['subject'] == 'operator'
    assert 'a-token-for-test' not in repr(settings)
    assert 'private-test-password' not in repr(settings)
    monkeypatch.setenv('CCTV_ADAPTER_URL', 'https://override.example')
    monkeypatch.setenv('CCTV_ADAPTER_TOKEN', 'override-token')
    assert load_settings().adapter_token == 'override-token'


def test_malformed_a_secrets_are_not_silently_ignored(config_env):
    path = config_env.parent / 'a-secrets.json'
    path.write_text('{ invalid JSON')
    with pytest.raises(ValueError, match='A credentials'):
        load_settings()


def test_env_file_is_loaded_but_process_environment_wins(config_env, monkeypatch):
    env_file = config_env.parent / '.env'
    env_file.write_text('OPENAI_API_KEY=sk-file-value\nOPENAI_MODEL=file-model\n'
                        'CCTV_WORKER_ENABLED=true\nCCTV_AI_DEVICE=cpu\n', encoding='utf-8')
    settings = load_settings()
    assert settings.openai_api_key == 'sk-file-value'
    assert settings.openai_model == 'file-model'
    assert settings.worker_enabled is True
    assert settings.ai_device == 'cpu'
    assert 'sk-file-value' not in repr(settings)
    monkeypatch.setenv('OPENAI_MODEL', 'env-model')
    monkeypatch.setenv('OPENAI_API_KEY', '')
    settings = load_settings()
    assert settings.openai_model == 'env-model'
    assert settings.openai_api_key == ''


def test_ai_defaults_without_env_file(config_env):
    settings = load_settings()
    assert settings.openai_api_key == ''
    assert settings.worker_enabled is False
    assert settings.auto_analyze is True
    assert settings.ai_device == 'auto'
    assert settings.attachments_dir.name == 'attachments'
    assert settings.analysis_dir.name == 'analysis'


@pytest.mark.parametrize('key,value', [('CCTV_WORKER_ENABLED', 'maybe'), ('CCTV_AI_DEVICE', 'tpu')])
def test_invalid_ai_settings_fail_closed(config_env, monkeypatch, key, value):
    monkeypatch.setenv(key, value)
    with pytest.raises(ValueError):
        load_settings()
