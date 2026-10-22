import json
import math
import os
from pathlib import Path
import shutil
import subprocess
from urllib.parse import quote

from adapter import AdapterError

ROOT = Path(__file__).resolve().parent


def tool(name):
    explicit = os.environ.get('CCTV_' + name.upper())
    if explicit:
        path = Path(explicit)
    else:
        path = next((ROOT / 'tools/ffmpeg').rglob(name + '.exe'), None)
        if path is None:
            located = shutil.which(name)
            path = Path(located) if located else None
    if path is None or not path.is_file():
        raise AdapterError(503, 'B video tools are unavailable; run setup_tools.py')
    return str(path)


def inspect_clip(path):
    probe, decoder = tool('ffprobe'), tool('ffmpeg')
    try:
        options = {'capture_output': True, 'timeout': 20,
                   'creationflags': getattr(subprocess, 'CREATE_NO_WINDOW', 0)}
        safe_input = ['-protocol_whitelist', 'file,pipe', '-f', 'mov',
                      '-enable_drefs', '0', '-use_absolute_path', '0']
        result = subprocess.run([probe, '-v', 'error', *safe_input,
                                 '-show_entries', 'format=duration:stream=codec_type', '-of', 'json',
                                 str(path)], check=True, **options)
        metadata = json.loads(result.stdout)
        duration = float(metadata['format']['duration'])
        if not math.isfinite(duration) or duration <= 0 or not any(
                stream.get('codec_type') == 'video' for stream in metadata.get('streams', [])):
            raise ValueError()
        # Decode only the first video frame, not the entire recording.
        decoded = subprocess.run([decoder, '-v', 'error', '-xerror', *safe_input,
                                  '-i', str(path), '-map', '0:v:0', '-frames:v', '1',
                                  '-vf', 'scale=1:1', '-pix_fmt', 'gray', '-f', 'rawvideo', 'pipe:1'],
                                 check=True, **options)
        if len(decoded.stdout) != 1:
            raise ValueError('No decoded first frame')
        return duration
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError):
        raise AdapterError(502, 'Exported file is not a readable video') from None


def authenticated(url, user, password):
    """Insert separately shared RTSP credentials; the result is passed only to FFmpeg."""
    if not user or not password:
        raise AdapterError(503, 'RTSP credentials are not configured')
    return url.replace('rtsp://', f"rtsp://{quote(user, safe='')}:{quote(password, safe='')}@", 1)


def capture_live(url, user, password, seconds, target):
    """Copy the next `seconds` of an RTSP/TCP stream into an MP4 analysis cache file."""
    command = [tool('ffmpeg'), '-v', 'error', '-rtsp_transport', 'tcp', '-timeout', '8000000',
               '-i', authenticated(url, user, password), '-t', f'{seconds:.3f}', '-map', '0:v:0',
               '-c', 'copy', '-f', 'mp4', '-y', str(target)]
    try:
        subprocess.run(command, check=True, capture_output=True, timeout=seconds + 30,
                       creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    except (OSError, subprocess.SubprocessError):
        # FFmpeg stderr can echo the authenticated URL; never relay it.
        raise AdapterError(503, 'Live stream capture failed') from None
    if not Path(target).is_file() or Path(target).stat().st_size == 0:
        raise AdapterError(503, 'Live stream capture produced no video')


def snapshot(url, user, password, width=960):
    """Decode one current frame as JPEG bytes."""
    command = [tool('ffmpeg'), '-v', 'error', '-rtsp_transport', 'tcp', '-timeout', '8000000',
               '-i', authenticated(url, user, password), '-frames:v', '1', '-vf', f'scale={width}:-2',
               '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '5', 'pipe:1']
    try:
        result = subprocess.run(command, check=True, capture_output=True, timeout=20,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    except (OSError, subprocess.SubprocessError):
        raise AdapterError(503, 'Live frame capture failed') from None
    if not result.stdout.startswith(b'\xff\xd8'):
        raise AdapterError(502, 'Live frame is not a JPEG')
    return result.stdout
