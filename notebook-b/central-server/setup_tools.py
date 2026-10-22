"""Install B-only pinned FFmpeg binaries with checksum verification."""
import hashlib
import io
from pathlib import Path
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent
URL = 'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip'


def main():
    folder = ROOT / 'tools/ffmpeg'
    if list(folder.rglob('ffmpeg.exe')) and list(folder.rglob('ffprobe.exe')):
        print('B FFmpeg and ffprobe are already installed.')
        return
    with urllib.request.urlopen(URL + '.sha256', timeout=30) as response:
        expected = response.read().decode().split()[0]
    with urllib.request.urlopen(URL, timeout=120) as response:
        content = response.read()
    if hashlib.sha256(content).hexdigest() != expected:
        raise RuntimeError('B FFmpeg SHA256 validation failed')
    folder.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        archive.extractall(folder)
    print('B FFmpeg 9.0.2 and ffprobe installed; checksum verified. No A tools were started.')


if __name__ == '__main__':
    main()
