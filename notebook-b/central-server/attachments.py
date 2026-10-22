"""Consented reporter attachments: type from file signature, size limits, SHA256, private storage."""
import hashlib
from pathlib import Path
from uuid import uuid4

from adapter import AdapterError
from models import utc

LIMITS = {'image': 15 * 1024 ** 2, 'audio': 25 * 1024 ** 2, 'video': 100 * 1024 ** 2}
MAX_PER_REPORT = 10
CHUNK = 1024 * 1024


def sniff(head, declared):
    """Return (kind, content_type, extension) from magic bytes; the client name/type is not trusted."""
    declared = (declared or '').split(';')[0].strip().lower()
    if head.startswith(b'\xff\xd8\xff'):
        return 'image', 'image/jpeg', '.jpg'
    if head.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'image', 'image/png', '.png'
    if head[:4] == b'RIFF' and head[8:12] == b'WEBP':
        return 'image', 'image/webp', '.webp'
    if head[:4] == b'RIFF' and head[8:12] == b'WAVE':
        return 'audio', 'audio/wav', '.wav'
    if head.startswith(b'ID3') or (len(head) > 1 and head[0] == 0xFF and head[1] & 0xE0 == 0xE0):
        return 'audio', 'audio/mpeg', '.mp3'
    if head[4:8] == b'ftyp':
        brand = head[8:12]
        if brand in (b'M4A ', b'M4B ') or declared.startswith('audio/'):
            return 'audio', 'audio/mp4', '.m4a'
        if brand == b'qt  ':
            return 'video', 'video/quicktime', '.mov'
        return 'video', 'video/mp4', '.mp4'
    if head.startswith(b'\x1a\x45\xdf\xa3'):
        return ('audio', 'audio/webm', '.webm') if declared.startswith('audio/') else ('video', 'video/webm', '.webm')
    return None


class Attachments:
    def __init__(self, folder, store):
        self.folder, self.store = Path(folder), store

    def save(self, report, upload, consent, actor):
        if consent is not True:
            raise AdapterError(422, 'Explicit consent=true is required for every attachment')
        if len(self.store.attachments(report['report_id'])) >= MAX_PER_REPORT:
            raise AdapterError(409, f'At most {MAX_PER_REPORT} attachments per report')
        head = upload.file.read(64)
        detected = sniff(head, upload.content_type)
        if detected is None:
            raise AdapterError(415, 'Only JPEG/PNG/WebP images, WAV/MP3/M4A/WebM audio and MP4/MOV/WebM video')
        kind, content_type, extension = detected
        attachment_id = uuid4().hex
        folder = self.folder / report['report_id']
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / (attachment_id + extension)
        partial = target.with_suffix('.partial')
        digest, length = hashlib.sha256(head), len(head)
        saved = False
        try:
            with partial.open('xb') as output:
                output.write(head)
                while chunk := upload.file.read(CHUNK):
                    length += len(chunk)
                    if length > LIMITS[kind]:
                        raise AdapterError(413, f'{kind} attachments are limited to {LIMITS[kind] // 1024 ** 2} MiB')
                    digest.update(chunk)
                    output.write(chunk)
            if length == 0:
                raise AdapterError(422, 'Empty attachment')
            partial.rename(target)
            metadata = {'attachment_id': attachment_id, 'report_id': report['report_id'], 'kind': kind,
                        'content_type': content_type, 'bytes': length, 'sha256': digest.hexdigest(),
                        'stored_name': target.name, 'original_name': (upload.filename or '')[:200],
                        'consent': True, 'uploaded_by_role': actor['role'], 'created_at': utc(),
                        'download_path': f"/api/v1/reports/{report['report_id']}/attachments/{attachment_id}"}
            self.store.save_attachment(metadata, actor['subject'])
            saved = True
        except OSError:
            raise AdapterError(503, 'B attachment storage is unavailable') from None
        finally:
            partial.unlink(missing_ok=True)
            if not saved:
                target.unlink(missing_ok=True)
        return {key: value for key, value in metadata.items() if key != 'stored_name'}

    def path(self, report_id, attachment_id):
        for attachment in self.store.attachments(report_id):
            if attachment['attachment_id'] == attachment_id:
                path = self.folder / report_id / attachment['stored_name']
                if path.is_file():
                    return path, attachment
        raise AdapterError(404, 'Attachment not found')
