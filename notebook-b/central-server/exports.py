"""Admin exports: a report list as Excel-friendly CSV and one report as a hashed evidence ZIP."""
import csv
from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
from pathlib import Path
import tempfile
import zipfile

from models import utc

KST = timezone(timedelta(hours=9))
# Cells starting with these run as formulas in Excel/Sheets; reports are citizen-written text.
FORMULA = ('=', '+', '-', '@', '\t', '\r')
COLUMNS = ('신고 ID', '접수 시각(KST)', '출처', '사건 유형', '신고 내용', '상세', '발생 시각(KST)', '위도', '경도',
           '위치 구분', '검색 반경(m)', '분석 상태', '분석 단계', '분석 결과', '선정 카메라', '요약', '권장 조치',
           '첨부 수', '확인 시각(KST)', '확인자', '확인 메모', '종결 시각(KST)', '종결자', '종결 메모')


def kst(value):
    if not value:
        return ''
    return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(KST).strftime('%Y-%m-%d %H:%M:%S')


def cell(value):
    text = '' if value is None else str(value)
    return "'" + text if text.startswith(FORMULA) else text


def reports_csv(reports):
    """UTF-8 with BOM so Excel opens Korean text correctly."""
    output = io.StringIO()
    writer = csv.writer(output, lineterminator='\r\n')
    writer.writerow(COLUMNS)
    for report in reports:
        analysis = report['analysis'] or {}
        summary = analysis.get('summary') or {}
        review = report['review'] or {}
        writer.writerow(cell(value) for value in (
            report['report_id'], kst(report['created_at']), report['source'],
            (analysis.get('classification') or {}).get('incident_type'), report.get('description'),
            report.get('details'), kst(report.get('occurred_at')), report['latitude'], report['longitude'],
            report.get('location_kind'), report.get('radius_m'), report['job']['state'], report['job']['stage'],
            analysis.get('outcome'), ' '.join(analysis.get('selected_camera_ids') or []),
            summary.get('reporter_claim'), summary.get('recommended_next_step'), len(report['attachments']),
            kst(review.get('confirmed_at')), review.get('confirmed_by'), review.get('confirm_note'),
            kst(review.get('closed_at')), review.get('closed_by'), review.get('close_note')))
    return '﻿' + output.getvalue()


def sha256(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def report_package(folder, report, clips, audit, sources, actor, media):
    """Write the evidence ZIP to a temporary file in `folder` and return its path.

    `sources` maps archive names to (local path, recorded SHA256 or None). Missing files are listed
    in the manifest instead of failing the export; recorded hashes are re-checked.
    """
    folder.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(dir=folder, suffix='.zip', delete=False)
    handle.close()
    target = Path(handle.name)
    files, missing = [], []
    documents = {'report.json': report, 'clips.json': clips, 'audit.json': audit}
    try:
        with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
            for name, data in documents.items():
                body = json.dumps(data, ensure_ascii=False, indent=2).encode('utf-8')
                archive.writestr(name, body)
                files.append({'path': name, 'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()})
            for name, (path, recorded) in (sources.items() if media else ()):
                if not path.is_file():
                    missing.append(name)
                    continue
                digest = sha256(path)
                # Media is already compressed; storing avoids burning CPU for no gain.
                archive.write(path, name, compress_type=zipfile.ZIP_STORED)
                entry = {'path': name, 'bytes': path.stat().st_size, 'sha256': digest}
                if recorded is not None:
                    entry['matches_recorded_sha256'] = digest == recorded
                files.append(entry)
            manifest = {'report_id': report['report_id'], 'generated_at': utc(), 'generated_by': actor,
                        'includes_media': media, 'files': files, 'missing': missing,
                        'note': 'SHA256 values let the recipient verify that files were not altered after export.'}
            archive.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2))
    except BaseException:
        target.unlink(missing_ok=True)
        raise
    return target
