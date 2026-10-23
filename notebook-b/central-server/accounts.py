"""Reporter accounts: ID/password sign-up and login that issue long-lived reporter tokens.

No email or phone number is collected. Passwords are stored as scrypt hashes and tokens as
SHA-256 hashes; the raw token is returned once, at issue time. Failed logins and sign-ups are
rate limited in memory per username and client address.
"""
import hashlib
import hmac
import secrets
import threading
import time
from collections import defaultdict, deque

from adapter import AdapterError
from models import utc

SCRYPT = {'n': 2 ** 14, 'r': 8, 'p': 1}
LOGIN_FAILURES, LOGIN_WINDOW = 5, 600
SIGNUPS, SIGNUP_WINDOW = 30, 3600  # visitors may share one venue Wi-Fi address


def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode('utf-8'), salt=salt, dklen=32, **SCRYPT)
    return f"scrypt${SCRYPT['n']}${SCRYPT['r']}${SCRYPT['p']}${salt.hex()}${digest.hex()}"


def verify_password(password, stored):
    try:
        _, n, r, p, salt, expected = stored.split('$')
        digest = hashlib.scrypt(password.encode('utf-8'), salt=bytes.fromhex(salt), dklen=32,
                                n=int(n), r=int(r), p=int(p))
    except ValueError:
        return False
    return hmac.compare_digest(digest.hex(), expected)


def token_hash(token):
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


class RateLimit:
    def __init__(self, limit, window, clock=time.monotonic):
        self.limit, self.window, self.clock = limit, window, clock
        self.hits, self.lock = defaultdict(deque), threading.Lock()

    def blocked(self, key):
        with self.lock:
            hits = self.hits[key]
            while hits and self.clock() - hits[0] > self.window:
                hits.popleft()
            return len(hits) >= self.limit

    def hit(self, key):
        with self.lock:
            self.hits[key].append(self.clock())

    def clear(self, key):
        with self.lock:
            self.hits.pop(key, None)


class Accounts:
    def __init__(self, store, clock=time.monotonic):
        self.store = store
        self.failures = RateLimit(LOGIN_FAILURES, LOGIN_WINDOW, clock)
        self.signups = RateLimit(SIGNUPS, SIGNUP_WINDOW, clock)
        # A fixed dummy hash keeps unknown-user logins as slow as wrong-password logins.
        self.dummy = hash_password(secrets.token_hex(8))

    @staticmethod
    def subject(username):
        return 'reporter:' + username

    def _issue(self, database, username):
        token = secrets.token_urlsafe(32)
        database.execute('INSERT INTO reporter_tokens VALUES (?,?,?,NULL)', (token_hash(token), username, utc()))
        return token

    def signup(self, username, password, client):
        if self.signups.blocked(client):
            raise AdapterError(429, 'Too many sign-ups from this address; try again later')
        self.signups.hit(client)
        stored = hash_password(password)
        with self.store.connect() as database:
            if database.execute('SELECT 1 FROM reporter_accounts WHERE username=?', (username,)).fetchone():
                raise AdapterError(409, 'Username is already taken')
            database.execute('INSERT INTO reporter_accounts VALUES (?,?,?)', (username, stored, utc()))
            token = self._issue(database, username)
        return {'username': username, 'token': token}

    def login(self, username, password, client):
        keys = ('user:' + username, 'client:' + client)
        if any(self.failures.blocked(key) for key in keys):
            raise AdapterError(429, 'Too many failed logins; try again in 10 minutes')
        with self.store.connect() as database:
            row = database.execute('SELECT password_hash FROM reporter_accounts WHERE username=?',
                                   (username,)).fetchone()
            valid = verify_password(password, row['password_hash'] if row else self.dummy) and row is not None
            if not valid:
                for key in keys:
                    self.failures.hit(key)
                raise AdapterError(401, 'Username or password is incorrect')
            token = self._issue(database, username)
        self.failures.clear(keys[0])
        return {'username': username, 'token': token}

    def identity(self, token):
        if not token:
            return None
        with self.store.connect() as database:
            row = database.execute('SELECT username FROM reporter_tokens WHERE token_hash=? AND revoked_at IS NULL',
                                   (token_hash(token),)).fetchone()
        return {'role': 'reporter', 'subject': self.subject(row['username'])} if row else None

    def logout(self, token):
        with self.store.connect() as database:
            database.execute('UPDATE reporter_tokens SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL',
                             (utc(), token_hash(token)))

    def reset_password(self, username, password):
        stored = hash_password(password)
        with self.store.connect() as database:
            if not database.execute('UPDATE reporter_accounts SET password_hash=? WHERE username=?',
                                    (stored, username)).rowcount:
                raise AdapterError(404, 'Reporter account not found')
            database.execute('UPDATE reporter_tokens SET revoked_at=? WHERE username=? AND revoked_at IS NULL',
                             (utc(), username))
        self.failures.clear('user:' + username)
