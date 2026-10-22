import hashlib,json,pathlib,unittest,urllib.request,urllib.error

ROOT=pathlib.Path(__file__).resolve().parent
class AdapterTests(unittest.TestCase):
    def request(self,path,data=None,authenticated=True):
        headers={}
        if authenticated:
            headers['Authorization']='Bearer '+json.loads((ROOT/'secrets.json').read_text())['token']
        if data is not None:headers['Content-Type']='application/json'
        return urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8766'+path,
            data=json.dumps(data).encode() if data is not None else None,headers=headers),timeout=30)
    def test_auth_required(self):
        with self.assertRaises(urllib.error.HTTPError) as cm:self.request('/agent/v1/health',authenticated=False)
        self.assertEqual(cm.exception.code,401)
        cm.exception.close()
    def test_live_health(self):
        with self.request('/agent/v1/cameras') as r: self.assertEqual(len(json.load(r)['cameras']),3)
    def test_reject_traversal_and_bad_export(self):
        for data in ({'camera_id':'../cam-01','start':'2026-10-22T00:00:00Z','duration':1},
                     {'camera_id':'cam-01','start':'2026-10-22T00:00:00','duration':1},
                     {'camera_id':'cam-01','start':'2026-10-22T00:00:00Z','duration':-1}):
            with self.assertRaises(urllib.error.HTTPError) as cm:self.request('/agent/v1/recordings/export',data)
            self.assertEqual(cm.exception.code,400)
            cm.exception.close()
    def test_export_hash_and_download(self):
        with self.request('/agent/v1/recordings?camera_id=cam-01') as r: rows=json.load(r)['ranges']
        self.assertTrue(rows)
        with self.request('/agent/v1/recordings/export',{'camera_id':'cam-01','start':rows[0]['start'],'duration':3}) as r:
            result=json.load(r)
        with self.request(result['download_path']) as r: body=r.read()
        self.assertEqual(hashlib.sha256(body).hexdigest(),result['sha256'])
        self.assertEqual(len(body),result['bytes'])
if __name__=='__main__':unittest.main()
