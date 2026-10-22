"""Download pinned Windows tools; binaries stay outside git."""
import hashlib,io,json,pathlib,urllib.request,zipfile
ROOT=pathlib.Path(__file__).resolve().parent
def download(url):
    with urllib.request.urlopen(url,timeout=120) as response: return response.read()
def install():
    folder=ROOT/'tools'; folder.mkdir(exist_ok=True)
    release=json.loads(download('https://api.github.com/repos/bluenviron/mediamtx/releases/tags/v1.21.2'))
    asset=next(a for a in release['assets'] if a['name'].endswith('windows_amd64.zip'))
    if not (folder/'mediamtx/mediamtx.exe').exists():
        content=download(asset['browser_download_url'])
        digest=asset.get('digest')
        if not digest or digest != 'sha256:'+hashlib.sha256(content).hexdigest():
            raise RuntimeError('MediaMTX SHA256 validation failed')
        zipfile.ZipFile(io.BytesIO(content)).extractall(folder/'mediamtx')
    if not list(folder.rglob('ffmpeg.exe')):
        url='https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip'
        content=download(url)
        expected=download(url+'.sha256').decode().split()[0]
        if hashlib.sha256(content).hexdigest()!=expected: raise RuntimeError('FFmpeg SHA256 validation failed')
        zipfile.ZipFile(io.BytesIO(content)).extractall(folder/'ffmpeg')
    print('Tools ready: MediaMTX 1.21.2 / FFmpeg 9.0.2')
if __name__=='__main__': install()
