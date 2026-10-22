import json
import math
import os
from pathlib import Path
import shutil
import subprocess

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
