from contextlib import contextmanager
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import sqlite3
from uuid import uuid4

from models import DEMO_CAMERA_IDS, utc


class Store:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as database:
            database.executescript('''
                CREATE TABLE IF NOT EXISTS reports (
                    id TEXT PRIMARY KEY, owner TEXT NOT NULL, source TEXT NOT NULL,
                    created_at TEXT NOT NULL, payload TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY, report_id TEXT NOT NULL UNIQUE REFERENCES reports(id),
                    state TEXT NOT NULL, stage TEXT NOT NULL, progress REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS cameras (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, online INTEGER NOT NULL,
                    recording INTEGER NOT NULL, synced_at TEXT NOT NULL,
                    latitude REAL, longitude REAL, kind TEXT,
                    approved INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS clips (
                    id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES reports(id),
                    metadata TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS audit_events (
                    created_at TEXT NOT NULL, event TEXT NOT NULL, actor TEXT NOT NULL,
                    report_id TEXT NOT NULL, clip_id TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS attachments (
                    id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES reports(id),
                    metadata TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS analyses (
                    report_id TEXT PRIMARY KEY REFERENCES reports(id), result TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS events (
                    report_id TEXT NOT NULL REFERENCES reports(id), created_at TEXT NOT NULL,
                    type TEXT NOT NULL, message TEXT NOT NULL, data TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS reviews (
                    report_id TEXT PRIMARY KEY REFERENCES reports(id), confirmed_at TEXT, confirmed_by TEXT,
                    confirm_note TEXT, closed_at TEXT, closed_by TEXT, close_note TEXT
                );
                CREATE TABLE IF NOT EXISTS reporter_accounts (
                    username TEXT PRIMARY KEY, password_hash TEXT NOT NULL, created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS reporter_tokens (
                    token_hash TEXT PRIMARY KEY, username TEXT NOT NULL REFERENCES reporter_accounts(username),
                    created_at TEXT NOT NULL, revoked_at TEXT
                );
            ''')
            # Additive migrations for databases created by earlier B versions.
            for table, column, kind in (('jobs', 'params', 'TEXT'), ('jobs', 'error', 'TEXT'),
                                        ('jobs', 'updated_at', 'TEXT'), ('cameras', 'zone', 'TEXT'),
                                        ('jobs', 'rerun', 'INTEGER NOT NULL DEFAULT 0')):
                columns = {row['name'] for row in database.execute(f'PRAGMA table_info({table})')}
                if column not in columns:
                    database.execute(f'ALTER TABLE {table} ADD COLUMN {column} {kind}')
            # A worker that died mid-job must not leave the report stuck as running.
            database.execute("""UPDATE jobs SET state='failed', stage='MANUAL_REVIEW_REQUIRED',
                                error='B server restarted during analysis' WHERE state='running'""")

    @contextmanager
    def connect(self):
        database = sqlite3.connect(self.path, timeout=10)
        database.row_factory = sqlite3.Row
        database.execute('PRAGMA foreign_keys=ON')
        try:
            with database:
                yield database
        finally:
            database.close()

    def create_report(self, payload, owner, source, analysis=None):
        report_id, job_id, created = uuid4().hex, uuid4().hex, utc()
        data = payload.model_dump(mode='json')
        if payload.occurred_at is not None:
            data['occurred_at'] = utc(payload.occurred_at)
        with self.connect() as database:
            database.execute('INSERT INTO reports VALUES (?, ?, ?, ?, ?)',
                             (report_id, owner, source, created, json.dumps(data, ensure_ascii=False)))
            database.execute('''INSERT INTO jobs (id,report_id,state,stage,progress,params,updated_at)
                                VALUES (?,?,?,?,?,?,?)''',
                             (job_id, report_id, 'queued', 'awaiting_worker', 0,
                              json.dumps(analysis) if analysis else None, created))
            database.execute('INSERT INTO events VALUES (?,?,?,?,?)',
                             (report_id, created, 'received', '신고 접수', '{}'))
        return self.report(report_id)

    def report(self, report_id):
        with self.connect() as database:
            row = database.execute('SELECT * FROM reports WHERE id=?', (report_id,)).fetchone()
            if row is None:
                return None
            job = database.execute('SELECT * FROM jobs WHERE report_id=?', (report_id,)).fetchone()
        return {**json.loads(row['payload']), 'report_id': row['id'], 'owner': row['owner'],
                'source': row['source'], 'created_at': row['created_at'], 'job': self._job(job)}

    @staticmethod
    def _job(row):
        job = dict(row)
        job['params'] = json.loads(job['params']) if job.get('params') else None
        return job

    def detail(self, report_id):
        report = self.report(report_id)
        if report is None:
            return None
        with self.connect() as database:
            analysis = database.execute('SELECT result FROM analyses WHERE report_id=?', (report_id,)).fetchone()
            review = database.execute('SELECT * FROM reviews WHERE report_id=?', (report_id,)).fetchone()
        report.update(attachments=self.attachments(report_id), events=self.events(report_id),
                      analysis=json.loads(analysis['result']) if analysis else None,
                      review=dict(review) if review else None)
        return report

    def request_analysis(self, report_id, params):
        """Queue (or re-queue) the report's single analysis job; False while it is running."""
        now = utc()
        with self.connect() as database:
            cursor = database.execute('''UPDATE jobs SET state='queued', stage='awaiting_worker', progress=0,
                                         params=?, error=NULL, rerun=0, updated_at=?
                                         WHERE report_id=? AND state!='running' ''',
                                      (json.dumps(params), now, report_id))
            if cursor.rowcount:
                database.execute('INSERT INTO events VALUES (?,?,?,?,?)',
                                 (report_id, now, 'analysis_requested', '분석 요청', json.dumps(params)))
        return cursor.rowcount > 0

    def request_rerun(self, report_id):
        """Re-run the report's last analysis now, or once the running one finishes."""
        job = self.report(report_id)['job']
        if job['params'] is None:
            return False
        if self.request_analysis(report_id, job['params']):
            return True
        with self.connect() as database:
            database.execute("UPDATE jobs SET rerun=1 WHERE report_id=? AND state='running'", (report_id,))
        return True

    def take_rerun(self, report_id):
        """After a run ends: queue the deferred re-run, if one was requested meanwhile."""
        with self.connect() as database:
            pending = database.execute('UPDATE jobs SET rerun=0 WHERE report_id=? AND rerun=1',
                                       (report_id,)).rowcount
        if pending:
            job = self.report(report_id)['job']
            self.request_analysis(report_id, job['params'])
            self.event(report_id, 'analysis_rerun', '첨부 반영 재분석')
        return bool(pending)

    def claim_job(self):
        with self.connect() as database:
            row = database.execute('''SELECT jobs.id FROM jobs JOIN reports ON reports.id=jobs.report_id
                                      WHERE state='queued' AND params IS NOT NULL
                                      ORDER BY jobs.updated_at, created_at LIMIT 1''').fetchone()
            if row is None:
                return None
            requested = database.execute('SELECT updated_at FROM jobs WHERE id=?', (row['id'],)).fetchone()[0]
            claimed = database.execute('''UPDATE jobs SET state='running', stage='RECEIVED', updated_at=?
                                          WHERE id=? AND state='queued' ''', (utc(), row['id'])).rowcount
            job = database.execute('SELECT * FROM jobs WHERE id=?', (row['id'],)).fetchone()
        # Intake and re-analysis both set updated_at when queued: that is the request time.
        return {**self._job(job), 'requested_at': requested} if claimed else None

    def update_job(self, job_id, stage, progress, state='running', error=None):
        with self.connect() as database:
            database.execute('UPDATE jobs SET state=?, stage=?, progress=?, error=?, updated_at=? WHERE id=?',
                             (state, stage, progress, error, utc(), job_id))

    def save_analysis(self, report_id, result):
        with self.connect() as database:
            database.execute('''INSERT INTO analyses VALUES (?,?,?) ON CONFLICT(report_id)
                                DO UPDATE SET result=excluded.result, updated_at=excluded.updated_at''',
                             (report_id, json.dumps(result, ensure_ascii=False), utc()))

    def event(self, report_id, kind, message, data=None):
        with self.connect() as database:
            database.execute('INSERT INTO events VALUES (?,?,?,?,?)',
                             (report_id, utc(), kind, message, json.dumps(data or {}, ensure_ascii=False)))

    def events(self, report_id):
        with self.connect() as database:
            rows = database.execute('SELECT * FROM events WHERE report_id=? ORDER BY rowid', (report_id,)).fetchall()
        return [{**dict(row), 'data': json.loads(row['data'])} for row in rows]

    def save_attachment(self, metadata, actor):
        now = utc()
        with self.connect() as database:
            database.execute('INSERT INTO attachments VALUES (?,?,?)',
                             (metadata['attachment_id'], metadata['report_id'],
                              json.dumps(metadata, ensure_ascii=False)))
            database.execute('INSERT INTO audit_events VALUES (?,?,?,?,?)',
                             (now, 'attachment_uploaded', actor, metadata['report_id'], metadata['attachment_id']))
            database.execute('INSERT INTO events VALUES (?,?,?,?,?)',
                             (metadata['report_id'], now, 'attachment', '첨부 자료 수신',
                              json.dumps({'attachment_id': metadata['attachment_id'], 'kind': metadata['kind']})))

    def attachments(self, report_id):
        with self.connect() as database:
            rows = database.execute('SELECT metadata FROM attachments WHERE report_id=? ORDER BY rowid',
                                    (report_id,)).fetchall()
        return [json.loads(row['metadata']) for row in rows]

    def review(self, report_id, action, actor, note):
        now = utc()
        prefix, column = ('confirmed', 'confirm_note') if action == 'confirm' else ('closed', 'close_note')
        with self.connect() as database:
            database.execute('INSERT INTO reviews (report_id) VALUES (?) ON CONFLICT(report_id) DO NOTHING',
                             (report_id,))
            database.execute(f'UPDATE reviews SET {prefix}_at=?, {prefix}_by=?, {column}=? WHERE report_id=?',
                             (now, actor, note, report_id))
            database.execute('INSERT INTO events VALUES (?,?,?,?,?)',
                             (report_id, now, prefix, '담당자 확인' if action == 'confirm' else '사건 종결',
                              json.dumps({'by': actor, 'note': note}, ensure_ascii=False)))
            database.execute('INSERT INTO audit_events VALUES (?,?,?,?,?)',
                             (now, 'report_' + prefix, actor, report_id, ''))
            row = database.execute('SELECT * FROM reviews WHERE report_id=?', (report_id,)).fetchone()
        return dict(row)

    def metrics(self):
        with self.connect() as database:
            def count(sql):
                return database.execute(sql).fetchone()[0]

            def grouped(sql):
                return {row[0]: row[1] for row in database.execute(sql)}
            analyses = [json.loads(row['result']) for row in
                        database.execute('SELECT result FROM analyses ORDER BY updated_at DESC LIMIT 200')]
            return {
                'reports': grouped('SELECT source, COUNT(*) FROM reports GROUP BY source'),
                'jobs': grouped('SELECT state, COUNT(*) FROM jobs GROUP BY state'),
                'stages': grouped('SELECT stage, COUNT(*) FROM jobs GROUP BY stage'),
                'attachments': count('SELECT COUNT(*) FROM attachments'),
                'preserved_clips': count('SELECT COUNT(*) FROM clips'),
                'confirmed': count('SELECT COUNT(*) FROM reviews WHERE confirmed_at IS NOT NULL'),
                'closed': count('SELECT COUNT(*) FROM reviews WHERE closed_at IS NOT NULL'),
                'analyses': analyses,
            }

    def owner_reports(self, owner, limit, offset):
        with self.connect() as database:
            rows = database.execute('''SELECT id FROM reports WHERE owner=? AND source='reporter'
                                       ORDER BY created_at DESC, id LIMIT ? OFFSET ?''',
                                    (owner, limit, offset)).fetchall()
        return [self.report(row['id']) for row in rows]

    def reports(self, limit, offset):
        with self.connect() as database:
            rows = database.execute('SELECT id FROM reports ORDER BY created_at DESC, id LIMIT ? OFFSET ?',
                                    (limit, offset)).fetchall()
        return [self.report(row['id']) for row in rows]

    def jobs(self, limit):
        with self.connect() as database:
            rows = database.execute('''SELECT jobs.* FROM jobs JOIN reports ON reports.id=jobs.report_id
                                       WHERE state='queued' ORDER BY created_at, jobs.id LIMIT ?''',
                                    (limit,)).fetchall()
        return [self._job(row) for row in rows]

    def sync(self, snapshots):
        now = utc()
        with self.connect() as database:
            # Missing channels become unavailable; keep their registration for reconnection.
            database.execute('UPDATE cameras SET online=0, recording=0')
            for camera in snapshots:
                database.execute('''INSERT INTO cameras (id,name,online,recording,synced_at)
                    VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,
                    online=excluded.online, recording=excluded.recording, synced_at=excluded.synced_at''',
                                 (camera.id, camera.name, camera.online, camera.recording, now))

    def invalidate_cameras(self):
        with self.connect() as database:
            database.execute('UPDATE cameras SET online=0, recording=0')

    def cameras(self):
        with self.connect() as database:
            rows = database.execute('SELECT * FROM cameras ORDER BY id').fetchall()
        result = []
        for row in rows:
            camera = dict(row)
            for field in ('online', 'recording', 'approved'):
                camera[field] = bool(camera[field])
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(camera['synced_at'])).total_seconds()
            camera['fresh'] = 0 <= age <= 60
            camera['demo_source'] = camera['id'] in DEMO_CAMERA_IDS
            result.append(camera)
        return result

    def locate(self, camera_id, location):
        with self.connect() as database:
            cursor = database.execute('''UPDATE cameras SET latitude=?,longitude=?,kind=?,approved=?,zone=?
                                         WHERE id=?''', (location.latitude, location.longitude, location.kind,
                                                        location.approved, location.zone, camera_id))
        return cursor.rowcount > 0

    def candidates(self, report):
        candidates = []
        for camera in self.cameras():
            if not (camera['demo_source'] and camera['online'] and camera['fresh'] and camera['approved']
                    and camera['latitude'] is not None and camera['kind'] == report['location_kind']):
                continue
            lat1, lat2 = math.radians(report['latitude']), math.radians(camera['latitude'])
            delta_lat = lat2 - lat1
            delta_lon = math.radians(camera['longitude'] - report['longitude'])
            a = math.sin(delta_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
            distance = 6371008.8 * 2 * math.asin(math.sqrt(min(1.0, max(0.0, a))))
            if distance <= report['radius_m']:
                candidates.append({**camera, 'distance_m': round(distance, 2)})
        return sorted(candidates, key=lambda row: (row['distance_m'], row['id']))

    def save_clip(self, metadata, actor):
        with self.connect() as database:
            database.execute('INSERT INTO clips VALUES (?,?,?)',
                             (metadata['clip_id'], metadata['report_id'], json.dumps(metadata)))
            database.execute('INSERT INTO audit_events VALUES (?,?,?,?,?)',
                             (utc(), 'clip_preserved', actor, metadata['report_id'], metadata['clip_id']))

    def clips(self, report_id):
        with self.connect() as database:
            rows = database.execute('SELECT metadata FROM clips WHERE report_id=? ORDER BY rowid DESC',
                                    (report_id,)).fetchall()
        return [json.loads(row['metadata']) for row in rows]

    def clip(self, clip_id):
        with self.connect() as database:
            row = database.execute('SELECT metadata FROM clips WHERE id=?', (clip_id,)).fetchone()
        return json.loads(row['metadata']) if row else None

    def audit(self, event, actor, report_id, clip_id):
        with self.connect() as database:
            database.execute('INSERT INTO audit_events VALUES (?,?,?,?,?)',
                             (utc(), event, actor, report_id, clip_id))
