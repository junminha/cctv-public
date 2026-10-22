"""Generate local identities once. Never print credentials or overwrite them."""
import json
from pathlib import Path
import secrets

ROOT = Path(__file__).resolve().parent


def main():
    path = ROOT / 'runtime/secrets.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open('x', encoding='utf-8') as target:
            tokens = {secrets.token_urlsafe(32): {'role': role, 'subject': subject}
                      for role, subject in (('admin', 'local-operator'),
                                            ('reporter', 'demo-reporter'), ('agent', 'local-worker'))}
            json.dump({'tokens': tokens}, target, indent=2)
    except FileExistsError:
        print('Local credentials already exist; kept unchanged.')
    else:
        print('Created runtime/secrets.json. Credentials are local and were not printed.')


if __name__ == '__main__':
    main()
