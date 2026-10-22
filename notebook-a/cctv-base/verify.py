"""Real-device integration verification; does not create simulated footage."""
import argparse,datetime as dt,json,pathlib,subprocess,urllib.request,urllib.error
from urllib.parse import urlencode
from app import tool

def get(url):
    with urllib.request.urlopen(url,timeout=30) as r:return json.load(r)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--min-seconds',type=float,default=600)
    args=parser.parse_args()
    status=get('http://127.0.0.1:8765/api/status')
    report={'checked_at':dt.datetime.now(dt.timezone.utc).isoformat(),'base':status,
            'b_required':False,'channels':[],'external_network':'NOT_TESTED'}
    for cam in status['cameras']:
        assert cam['online'],f"{cam['id']} offline"
        result=subprocess.run([str(tool('ffmpeg')),'-hide_banner','-v','error',
            '-rtsp_transport','tcp','-i','rtsp://127.0.0.1:8554/'+cam['id'],
            '-t','2','-f','null','-'],capture_output=True,timeout=20)
        assert result.returncode==0,result.stderr.decode(errors='replace')
        rows=get('http://127.0.0.1:8765/api/recordings?camera='+cam['id'])
        longest=max(rows,key=lambda r:r['duration'])
        assert longest['duration']>=args.min_seconds,(cam['id'],longest)
        query=urlencode({'camera':cam['id'],'start':longest['start'],'duration':3})
        with urllib.request.urlopen('http://127.0.0.1:8765/api/playback?'+query,timeout=30) as r:
            with subprocess.Popen([str(tool('ffmpeg')),'-hide_banner','-v','error','-i','pipe:0',
                '-f','null','-'],stdin=subprocess.PIPE,stderr=subprocess.PIPE,stdout=subprocess.DEVNULL) as p:
                _,error=p.communicate(r.read(),timeout=20)
                assert p.returncode==0,error.decode(errors='replace')
        report['channels'].append({'id':cam['id'],'rtsp_decode':True,'playback_decode':True,
                                   'longest_continuous_seconds':longest['duration']})
    target=pathlib.Path(__file__).resolve().parents[2]/'shared/A-검증.json'
    target.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
