"""Removable authenticated adapter; never manages base recorder processes."""
import datetime as dt
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import sys
import threading
import urllib.error
import urllib.request
from urllib.parse import parse_qs,urlsplit,urlencode
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import uuid

ROOT=Path(__file__).resolve().parent
BASE=ROOT.parent/'cctv-base'
sys.path.insert(0,str(BASE))
from app import camera_id,utc_time,duration,recordings,upstream
EXPORT_LOCK=threading.BoundedSemaphore(1)

def config():
    path=ROOT/'secrets.json'
    if not path.exists():
        path.write_text(json.dumps({'token':secrets.token_urlsafe(32),
                                    'rtsp_user':'analysis','rtsp_password':secrets.token_urlsafe(24)},indent=2),encoding='utf-8')
    return json.loads(path.read_text(encoding='utf-8'))

def audit(event,**fields):
    (ROOT/'logs').mkdir(exist_ok=True)
    with (ROOT/'logs/audit.jsonl').open('a',encoding='utf-8') as f:
        f.write(json.dumps({'time':dt.datetime.now(dt.timezone.utc).isoformat(),
                            'event':event,**fields},ensure_ascii=False)+'\n')

def base_status():
    with urllib.request.urlopen('http://127.0.0.1:8765/api/status',timeout=5) as r: return json.load(r)

def export_clip(camera,start,seconds):
    if shutil.disk_usage(ROOT).free < 11*1024**3: raise ValueError('Insufficient export storage')
    folder=ROOT/'exports'; folder.mkdir(exist_ok=True)
    export_id=uuid.uuid4().hex
    partial=folder/(export_id+'.partial'); target=folder/(export_id+'.mp4')
    try:
        digest=hashlib.sha256()
        query=urlencode({'path':camera,'start':utc_time(start),'duration':duration(seconds),'format':'mp4'})
        with upstream(9996,'/get?'+query) as response, partial.open('wb') as out:
            while data:=response.read(1024*1024):
                out.write(data); digest.update(data)
        if partial.stat().st_size==0: raise ValueError('No recording found')
        partial.rename(target)
        result={'export_id':export_id,'camera_id':camera,'start':utc_time(start),
                'requested_duration':duration(seconds),'sha256':digest.hexdigest(),
                'bytes':target.stat().st_size,'download_path':'/agent/v1/exports/'+export_id,
                'source':'A original recording; remuxed MP4 derivative',
                'created':dt.datetime.now(dt.timezone.utc).isoformat()}
        (folder/(export_id+'.json')).write_text(json.dumps(result,indent=2),encoding='utf-8')
        audit('export_created',**result)
        return result
    finally: partial.unlink(missing_ok=True)

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def json(self,data,status=200):
        body=json.dumps(data,ensure_ascii=False).encode()
        self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    def authorized(self):
        supplied=self.headers.get('Authorization','')
        if not hmac.compare_digest(supplied.encode(),'Bearer '.encode()+self.server.settings['token'].encode()):
            audit('unauthorized',peer=self.client_address[0]);self.json({'error':'Unauthorized'},401);return False
        return True
    def do_GET(self):
        if not self.authorized(): return
        url=urlsplit(self.path);q={k:v[0] for k,v in parse_qs(url.query).items()}
        try:
            if url.path=='/agent/v1/health': self.json(base_status())
            elif url.path=='/agent/v1/cameras': self.json({'cameras':base_status()['cameras']})
            elif url.path=='/agent/v1/capabilities':
                self.json({'version':'1','live':['rtsp/tcp'],'recordings':True,'export':True,
                           'export_max_seconds':3600,'ai':False,'ptz':False})
            elif re.fullmatch(r'/agent/v1/cameras/[a-z0-9-]+/stream',url.path):
                c=camera_id(url.path.split('/')[-2],base_status()['cameras'])
                tail_ip=self.server.settings.get('tailscale_ip')
                if not tail_ip: return self.json({'error':'Tailscale relay not configured'},503)
                self.json({'camera_id':c,'url':f'rtsp://{tail_ip}:8555/{c}',
                           'transport':'tcp','authentication':'RTSP Basic; use separately shared credentials'})
            elif url.path=='/agent/v1/recordings':
                c=camera_id(q.get('camera_id'),base_status()['cameras'])
                self.json({'camera_id':c,'ranges':recordings(c,q.get('start'),q.get('end'))})
            elif re.fullmatch(r'/agent/v1/exports/[0-9a-f]{32}',url.path):
                key=url.path.rsplit('/',1)[-1];p=ROOT/'exports'/(key+'.mp4')
                if not p.is_file(): return self.json({'error':'Not found'},404)
                audit('export_downloaded',export_id=key)
                self.send_response(200);self.send_header('Content-Type','video/mp4')
                self.send_header('Content-Length',str(p.stat().st_size));self.end_headers()
                with p.open('rb') as f: shutil.copyfileobj(f,self.wfile)
            else: self.json({'error':'Not found'},404)
        except (ValueError,KeyError) as e: self.json({'error':str(e)},400)
        except urllib.error.HTTPError as e: self.json({'error':'Recording unavailable'},e.code)
        except OSError: self.json({'error':'Base unavailable'},503)
    def do_POST(self):
        if not self.authorized(): return
        if self.path!='/agent/v1/recordings/export':return self.json({'error':'Not found'},404)
        if not EXPORT_LOCK.acquire(blocking=False):return self.json({'error':'Export busy'},429)
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=8192: raise ValueError('Invalid request size')
            data=json.loads(self.rfile.read(length))
            c=camera_id(data['camera_id'],base_status()['cameras'])
            self.json(export_clip(c,utc_time(data['start']),duration(data['duration'])),201)
        except (ValueError,KeyError,TypeError) as e:self.json({'error':str(e)},400)
        except urllib.error.HTTPError as e:self.json({'error':'Recording unavailable'},e.code)
        except OSError:self.json({'error':'Base unavailable'},503)
        finally:EXPORT_LOCK.release()

def main():
    settings=config()
    server=ThreadingHTTPServer(('127.0.0.1',8766),Handler);server.settings=settings
    (ROOT/'runtime').mkdir(exist_ok=True)
    (ROOT/'runtime/adapter.pid').write_text(str(os.getpid()))
    audit('adapter_started')
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close();(ROOT/'runtime/adapter.pid').unlink(missing_ok=True)
if __name__=='__main__':main()
