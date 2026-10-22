import json

import pytest

from config import load_settings

TOKEN = 'local-config-test-' + 'x' * 32


@pytest.fixture
def config_env(monkeypatch, tmp_path):
    for key in ('CCTV_B_TOKENS', 'CCTV_ADAPTER_URL', 'CCTV_ADAPTER_TOKEN', 'CCTV_B_DATABASE'):
        monkeypatch.delenv(key, raising=False)
    path = tmp_path / 'secrets.json'
    path.write_text(json.dumps({'tokens': {TOKEN: {'role': 'admin', 'subject': 'operator'}}}))
    monkeypatch.setenv('CCTV_B_SECRETS_FILE', str(path))
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
