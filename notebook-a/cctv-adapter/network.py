"""Prepare a separate Tailscale-bound RTSP relay. Base stays loopback-only."""
import ipaddress,json,subprocess,time,socket
from pathlib import Path
from adapter import ROOT,BASE,config
import sys
sys.path.insert(0,str(BASE))
from app import tool,NO_WINDOW

def prepare():
    tailscale=Path('C:/Program Files/Tailscale/tailscale.exe')
    if not tailscale.exists():raise SystemExit('Install Tailscale and sign in first. See shared/A-운영.md')
    result=subprocess.run([str(tailscale),'ip','-4'],capture_output=True,text=True,check=True)
    address=result.stdout.strip(); ip=ipaddress.ip_address(address)
    if ip not in ipaddress.ip_network('100.64.0.0/10'):raise SystemExit('No valid Tailscale IPv4 address')
    # Never overwrite the PID of an already running relay.
    with socket.socket() as probe:
        if probe.connect_ex((address,8555))==0:
            raise SystemExit('Port 8555 already in use; stop the existing relay before configuring again')
    settings=config();settings['tailscale_ip']=address
    (ROOT/'secrets.json').write_text(json.dumps(settings,indent=2),encoding='utf-8')
    cameras=json.loads((BASE/'cameras.json').read_text(encoding='utf-8-sig'))
    text=f'''logLevel: info
rtspAddress: {address}:8555
rtspTransports: [tcp]
rtmp: false
hls: false
webrtc: false
srt: false
moq: false
authInternalUsers:
  - user: {settings['rtsp_user']}
    pass: {settings['rtsp_password']}
    permissions:
      - action: read
paths:
'''
    for cam in cameras:
        text+=f"  {cam['id']}:\n    source: rtsp://127.0.0.1:8554/{cam['id']}\n    rtspTransport: tcp\n    sourceOnDemand: true\n"
    path=ROOT/'mediamtx.generated.yml';path.write_text(text,encoding='utf-8')
    (ROOT/'logs').mkdir(exist_ok=True);(ROOT/'runtime').mkdir(exist_ok=True)
    with (ROOT/'logs/relay.log').open('ab') as log:
        p=subprocess.Popen([str(tool('mediamtx')),str(path)],cwd=ROOT,stdout=log,stderr=log,creationflags=NO_WINDOW)
    time.sleep(2)
    if p.poll() is not None: raise SystemExit('Relay failed to start; inspect logs/relay.log')
    (ROOT/'runtime/relay.pid').write_text(str(p.pid))
    print(f'Relay started on {address}:8555 (authenticated, Tailscale interface only)')
    print('Next: tailscale serve --bg --https=443 http://127.0.0.1:8766')
if __name__=='__main__':prepare()
