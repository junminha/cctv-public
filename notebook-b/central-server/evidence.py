"""Private evidence catalogue and shared filesystem/integrity boundaries."""
from collections import defaultdict
from datetime import datetime, timedelta
import hashlib
from pathlib import Path
import re
import threading
from urllib.parse import urlencode

from adapter import AdapterError
from models import DEMO_CAMERA_IDS, utc

HEADERS = {'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff',
           'Referrer-Policy': 'no-referrer'}
REPORT_ID = re.compile(r'[0-9a-f]{32}')
LOCKS = defaultdict(threading.RLock)


def report_lock(root, report_id):
    return LOCKS[(str(Path(root).resolve()), report_id)]


def safe_path(root, *parts):
    """Reject traversal and reparse-point escapes, including non-existing leaf paths."""
    if any(not isinstance(part, str) or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]*', part)
           or part in ('.', '..') for part in parts):
        raise AdapterError(404, 'Evidence not found')
    root = Path(root).resolve()
    candidate = root.joinpath(*parts)
    try:
        candidate.resolve().relative_to(root)
        for parent in (candidate, *candidate.parents):
            if parent == root:
                break
            if parent.is_symlink() or getattr(parent, 'is_junction', lambda: False)():
                raise ValueError()
    except (OSError, ValueError, RuntimeError):
        raise AdapterError(404, 'Evidence not found') from None
    return candidate


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def verify_file(path, metadata):
    try:
        valid = path.is_file() and path.stat().st_size == metadata['bytes'] and digest(path) == metadata['sha256']
    except OSError:
        valid = False
    if not valid:
        raise AdapterError(409, 'Evidence integrity check failed or file unavailable')


def ensure_version(store, report_id, version):
    detail = store.detail(report_id)
    if detail is None:
        raise AdapterError(404, 'Report not found')
    if analysis_busy(detail) or (detail.get('analysis') or {}).get('started_at') != version:
        raise AdapterError(409, 'Analysis changed or is in progress; refresh evidence')
    return detail


def range_served(header, size):
    """True when a GET will answer with content (no Range, or a satisfiable one); failures are not audited."""
    if not header:
        return True
    match = re.fullmatch(r'bytes=(.+)', header.strip())
    if not match:
        return False
    for part in match.group(1).split(','):
        bounds = re.fullmatch(r'\s*(\d*)-(\d*)\s*', part)
        if not bounds or bounds.groups() == ('', ''):
            return False
        start, end = bounds.groups()
        if start and (int(start) >= size or (end and int(end) < int(start))):
            return False
        if not start and int(end) == 0:
            return False
    return True


def analysis_busy(detail):
    # A newly submitted report has a legacy queued placeholder without an analysis request.
    job = detail['job']
    return job['state'] == 'running' or (job['state'] == 'queued' and (job.get('params') is not None
                                                                     or detail.get('analysis') is not None))


class Evidence:
    def __init__(self, store, attachments, clips, analysis_dir):
        self.store, self.attachments, self.clips = store, attachments, clips
        self.analysis_dir = Path(analysis_dir)

    def catalog(self, report_id):
        if not REPORT_ID.fullmatch(report_id):
            raise AdapterError(404, 'Report not found')
        detail = self.store.detail(report_id)
        if detail is None:
            raise AdapterError(404, 'Report not found')
        analysis = detail.get('analysis') or {}
        version, items, warnings = analysis.get('started_at'), [], []

        def add(category, key, path, kind, label, representation, content_type, stored=None,
                captured=None, seconds=None, recorded=None, recorded_bytes=None, **extra):
            item_id = hashlib.sha256(f'{report_id}:{category}:{key}'.encode()).hexdigest()
            available = path.is_file()
            base = f'/api/v1/admin/reports/{report_id}/evidence/{item_id}'
            query = '?' + urlencode({'analysis_started_at': version}) if category == 'artifact' else ''
            if category == 'attachment':
                view = f'/api/v1/reports/{report_id}/attachments/{extra["attachment_id"]}?disposition=inline'
                download = view.replace('=inline', '=attachment')
            elif category == 'clip':
                view = f'/api/v1/admin/clips/{extra["clip_id"]}/view'
                download = view.replace('/view', '/download')
            else:
                view = f'/api/v1/admin/reports/{report_id}/artifacts/{key}' + query
                download = view + '&disposition=attachment'
            items.append({'id': item_id, 'category': category, 'kind': kind, 'label': label,
                          'representation': representation, 'content_type': content_type,
                          'bytes': path.stat().st_size if available else None, 'stored_at': stored,
                          'captured_at': captured, 'timestamp_seconds': seconds,
                          'recorded_sha256': recorded, 'current_sha256': None, 'integrity': 'unknown',
                          'available': available, 'view_url': view, 'download_url': download,
                          'thumbnail_url': base + '/thumbnail' + query if available and kind != 'audio' else None,
                          'analysis_started_at': version if category == 'artifact' else None, **extra,
                          '_path': path, '_recorded_bytes': recorded_bytes})

        for row in self.store.attachments(report_id):
            if not REPORT_ID.fullmatch(row['attachment_id']) or row['stored_name'] != row['attachment_id'] + Path(row['stored_name']).suffix:
                continue
            path = safe_path(self.attachments.folder, report_id, row['stored_name'])
            add('attachment', row['attachment_id'], path, row['kind'], row.get('original_name') or '신고자 첨부',
                'upload_original', row['content_type'], row.get('created_at'),
                recorded=row['sha256'], recorded_bytes=row['bytes'], attachment_id=row['attachment_id'])
        for row in self.store.clips(report_id):
            if row.get('camera_id') not in DEMO_CAMERA_IDS or not REPORT_ID.fullmatch(row['clip_id']):
                continue
            path = safe_path(self.clips.folder, row['clip_id'] + '.mp4')
            add('clip', row['clip_id'], path, 'video', row['camera_id'] + ' 보존 영상', 'remux_copy',
                'video/mp4', row.get('created_at'), row.get('start'), recorded=row['sha256'],
                recorded_bytes=row['bytes'], clip_id=row['clip_id'], camera_id=row['camera_id'])
        if analysis_busy(detail):
            warnings.append('분석 대기/실행 중에는 근거 이미지를 표시하지 않습니다.')
        elif version:
            owners = [(kind, row['camera_id'], row.get(kind) or {}, (row.get('window') or {}).get('start'))
                      for row in analysis.get('cameras', []) if row.get('camera_id') in DEMO_CAMERA_IDS
                      for kind in ('scan', 'focus', 'all')]
            attachments = {row['attachment_id'] for row in self.store.attachments(report_id)}
            owners += [('phone', row['attachment_id'], row.get('analysis') or {}, None)
                       for row in analysis.get('phone', []) if row.get('attachment_id') in attachments]
            for kind, owner, observed, start in owners:
                for entry in observed.get('evidence', []):
                    filename = entry.get('file', '')
                    if not re.fullmatch(r'evidence-0[1-3]\.jpg', filename):
                        continue
                    seconds, captured = entry.get('timestamp_seconds'), None
                    if start and seconds is not None:
                        try:
                            captured = utc(datetime.fromisoformat(start.replace('Z', '+00:00')) + timedelta(seconds=seconds))
                        except (ValueError, TypeError, OverflowError):
                            pass
                    path = safe_path(self.analysis_dir, report_id, kind, owner, filename)
                    add('artifact', f'{kind}/{owner}/{filename}', path, 'image',
                        f'{kind} {owner} 근거 (분석 상대 시각)', 'analysis_overlay', 'image/jpeg',
                        analysis.get('finished_at'), captured, seconds, artifact_kind=kind,
                        **({'attachment_id': owner} if kind == 'phone' else {'camera_id': owner}))
        return {'items': items, 'analysis_started_at': version, 'warnings': warnings}

    @staticmethod
    def public(item):
        return {key: value for key, value in item.items() if not key.startswith('_')}

    def item(self, report_id, item_id, version=None, verify=False):
        item = next((row for row in self.catalog(report_id)['items'] if row['id'] == item_id), None)
        # Check an explicitly supplied old version even if the worker omitted artifacts from the catalogue.
        if version is not None:
            ensure_version(self.store, report_id, version)
        if item is None:
            raise AdapterError(404, 'Evidence not found')
        if item['category'] == 'artifact':
            if version is None:
                raise AdapterError(422, 'analysis_started_at is required')
            ensure_version(self.store, report_id, version)
        if verify and item['available']:
            item['current_sha256'] = digest(item['_path'])
            if item['recorded_sha256']:
                item['integrity'] = ('match' if item['current_sha256'] == item['recorded_sha256']
                                     and item['bytes'] == item['_recorded_bytes'] else 'mismatch')
        return item
