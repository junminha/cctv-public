from datetime import datetime, timedelta
import hashlib
from pathlib import Path
import shutil
import threading
import time
from uuid import uuid4

import httpx

from adapter import AdapterError
from media import inspect_clip, tool
from models import DEMO_CAMERA_IDS, utc


def ranges_cover(ranges, start, end):
    cursor = start
    for row in sorted(ranges, key=lambda item: datetime.fromisoformat(item['start'])):
        left = datetime.fromisoformat(row['start'])
        right = left + timedelta(seconds=row['duration'])
        if left > cursor:
            return False
        if right > cursor:
            cursor = right
        if cursor >= end:
            return True
    return False


def download_export(adapter, exported, partial):
    """Stream an A export to a new file, enforcing declared size and SHA256."""
    digest, length = hashlib.sha256(), 0
    try:
        # Only reconstruct the contracted path on the configured A host.
        with adapter.http.stream('GET', adapter.url + '/agent/v1/exports/' + exported.export_id,
                headers={'Authorization': 'Bearer ' + adapter.token}, timeout=60) as response:
            if response.status_code != 200:
                raise AdapterError(503, 'A export download failed')
            deadline = time.monotonic() + 180
            with partial.open('xb') as output:
                for chunk in response.iter_bytes():
                    if time.monotonic() > deadline:
                        raise AdapterError(503, 'A export download exceeded the time limit')
                    length += len(chunk)
                    if length > exported.bytes:
                        raise AdapterError(502, 'A export exceeds the declared size')
                    digest.update(chunk)
                    output.write(chunk)
    except httpx.RequestError:
        raise AdapterError(503, 'A export download was interrupted') from None
    if length != exported.bytes or digest.hexdigest() != exported.sha256:
        raise AdapterError(502, 'A export hash or size mismatch')
    return digest.hexdigest(), length


class Clips:
    def __init__(self, folder, store, adapter):
        self.folder, self.store, self.adapter = Path(folder), store, adapter
        # A supports one export; this also bounds B download/decode work per process.
        self.lock = threading.BoundedSemaphore(1)

    def preserve(self, report, request, actor):
        if not self.lock.acquire(blocking=False):
            raise AdapterError(429, 'B preservation is busy; retry later')
        try:
            return self._preserve(report, request, actor)
        except OSError:
            raise AdapterError(503, 'B clip storage is unavailable') from None
        finally:
            self.lock.release()

    def _preserve(self, report, request, actor):
        camera = next((row for row in self.store.cameras() if row['id'] == request.camera_id), None)
        if camera is None:
            raise AdapterError(404, 'Camera not found')
        if request.camera_id not in DEMO_CAMERA_IDS:
            raise AdapterError(403, 'Only the three demo webcam channels may provide video')
        if not camera['approved'] or camera['kind'] != report['location_kind']:
            raise AdapterError(403, 'Camera analysis approval and matching location kind are required')
        tool('ffprobe')
        tool('ffmpeg')
        end = request.start + timedelta(seconds=request.duration)
        recording = self.adapter.recordings(request.camera_id, utc(request.start), utc(end))
        if not ranges_cover(recording['ranges'], request.start, end):
            raise AdapterError(409, 'Available recording ranges do not cover the request')
        exported = self.adapter.export(request)
        self.folder.mkdir(parents=True, exist_ok=True)
        if shutil.disk_usage(self.folder).free < exported.bytes + 512 * 1024 ** 2:
            raise AdapterError(503, 'B clip storage has insufficient free space')
        clip_id = uuid4().hex
        partial = self.folder / (clip_id + '.partial')
        target = self.folder / (clip_id + '.mp4')
        saved = False
        try:
            sha256, length = download_export(self.adapter, exported, partial)
            measured = inspect_clip(partial)
            metadata = {'clip_id': clip_id, 'report_id': report['report_id'], 'camera_id': request.camera_id,
                        'start': utc(request.start), 'requested_duration': request.duration,
                        'measured_duration': measured, 'sha256': sha256, 'bytes': length,
                        'upstream_export_id': exported.export_id, 'created_at': utc(),
                        'upstream_created_at': utc(exported.created),
                        'source': 'A recording export; remuxed derivative',
                        'recording_ranges_cover_request': True,
                        'duration_matches_request': abs(measured - request.duration) <= 1,
                        'download_path': '/api/v1/admin/clips/' + clip_id + '/download'}
            partial.rename(target)
            self.store.save_clip(metadata, actor)
            saved = True
            return metadata
        finally:
            partial.unlink(missing_ok=True)
            if not saved:
                target.unlink(missing_ok=True)

    def download(self, clip_id, actor):
        clip = self.store.clip(clip_id)
        if clip is None:
            raise AdapterError(404, 'Clip not found')
        path = self.folder / (clip_id + '.mp4')
        try:
            with path.open('rb') as source:
                digest = hashlib.file_digest(source, 'sha256').hexdigest()
            if path.stat().st_size != clip['bytes'] or digest != clip['sha256']:
                raise AdapterError(409, 'Preserved clip integrity check failed')
        except OSError:
            raise AdapterError(409, 'Preserved clip is unavailable') from None
        self.store.audit('clip_downloaded', actor, clip['report_id'], clip_id)
        return path
