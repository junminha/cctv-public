from contextlib import contextmanager
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import sqlite3
from uuid import uuid4

from models import utc


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
            ''')

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

    def create_report(self, payload, owner, source):
        report_id, job_id, created = uuid4().hex, uuid4().hex, utc()
        data = payload.model_dump(mode='json')
        if payload.occurred_at is not None:
            data['occurred_at'] = utc(payload.occurred_at)
        with self.connect() as database:
            database.execute('INSERT INTO reports VALUES (?, ?, ?, ?, ?)',
                             (report_id, owner, source, created, json.dumps(data, ensure_ascii=False)))
            database.execute('INSERT INTO jobs VALUES (?, ?, ?, ?, ?)',
                             (job_id, report_id, 'queued', 'awaiting_worker', 0))
        return self.report(report_id)

    def report(self, report_id):
        with self.connect() as database:
            row = database.execute('SELECT * FROM reports WHERE id=?', (report_id,)).fetchone()
            if row is None:
                return None
            job = database.execute('SELECT * FROM jobs WHERE report_id=?', (report_id,)).fetchone()
        return {**json.loads(row['payload']), 'report_id': row['id'], 'owner': row['owner'],
                'source': row['source'], 'created_at': row['created_at'], 'job': dict(job)}

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
        return [dict(row) for row in rows]

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
            result.append(camera)
        return result

    def locate(self, camera_id, location):
        with self.connect() as database:
            cursor = database.execute('''UPDATE cameras SET latitude=?,longitude=?,kind=?,approved=?
                                         WHERE id=?''', (location.latitude, location.longitude,
                                                        location.kind, location.approved, camera_id))
        return cursor.rowcount > 0

    def candidates(self, report):
        candidates = []
        for camera in self.cameras():
            if not (camera['online'] and camera['fresh'] and camera['approved']
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
