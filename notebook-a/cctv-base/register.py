"""Explicit initial registration; never silently reassign a camera ID."""
import json,re,subprocess
from app import ROOT,tool,NO_WINDOW

def discover():
    output = subprocess.run([str(tool('ffmpeg')), '-hide_banner', '-list_devices', 'true',
                             '-f','dshow','-i','dummy'], capture_output=True,
                            creationflags=NO_WINDOW).stderr.decode('utf-8', errors='replace')
    return re.findall(r'"([^"\n]+)" \(video\)\s*\n[^\n]*Alternative name "([^"\n]+)"', output)

if __name__ == '__main__':
    target = ROOT / 'cameras.json'
    devices = [(name,path) for name,path in discover() if path.startswith('@device_pnp_')]
    devices.sort(key=lambda d: (d[0] != 'HD Webcam', d[1]))
    if target.exists():
        print('Existing registration preserved. Connected physical cameras:')
        print(json.dumps(devices, ensure_ascii=False, indent=2))
    else:
        if len(devices) != 3: raise SystemExit(f'Expected 3 physical cameras, found {len(devices)}')
        cameras = [{'id':f'cam-{i:02}', 'name':('내장 전면카메라' if name=='HD Webcam' else f'USB 카메라 {i-1}'),
                    'device':path, 'size':'1280x720', 'capture_fps':30, 'input_format':'mjpeg'}
                   for i,(name,path) in enumerate(devices,1)]
        target.write_text(json.dumps(cameras,ensure_ascii=False,indent=2),encoding='utf-8')
        print('Registered:', ', '.join(c['id'] for c in cameras))
