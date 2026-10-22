import unittest,tempfile,pathlib
import app
import os,time,tempfile,pathlib
from unittest.mock import Mock
class SafetyTests(unittest.TestCase):
    def test_registered_camera_only(self):
        for value in ('../cam-01','cam-01/../../x','unknown',''):
            with self.assertRaises(ValueError): app.camera_id(value, [{'id':'cam-01'}])
        self.assertEqual(app.camera_id('cam-01',[{'id':'cam-01'}]),'cam-01')
    def test_time_requires_timezone(self):
        with self.assertRaises(ValueError): app.utc_time('2026-10-22T12:00:00')
        self.assertEqual(app.utc_time('2026-10-22T12:00:00+09:00'),'2026-10-22T03:00:00Z')
    def test_duration_bounds(self):
        for value in ('-1','nan','inf','0','3601'):
            with self.assertRaises(ValueError): app.duration(value)
        self.assertEqual(app.duration('60'),60)
    def test_only_recent_nonempty_recordings_are_evidence(self):
        with tempfile.TemporaryDirectory() as folder:
            root=pathlib.Path(folder);p=root/'segment.mp4';p.touch()
            self.assertIsNone(app.recording_evidence(root))
            p.write_bytes(b'closed segment')
            self.assertIsNotNone(app.recording_evidence(root))
            os.utime(p,(time.time()-180,time.time()-180))
            self.assertIsNone(app.recording_evidence(root))
    def test_subsecond_time_range(self):
        self.assertTrue(app.ordered_times('2026-10-22T00:00:00Z','2026-10-22T00:00:00.1Z'))
        self.assertFalse(app.ordered_times('2026-10-22T00:00:01Z','2026-10-22T00:00:00Z'))
    def test_fatal_supervisor_notifies_http_shutdown(self):
        recorder=app.Recorder.__new__(app.Recorder)
        recorder.run=Mock(side_effect=RuntimeError('test disk error'))
        recorder.close=Mock();recorder.failure_callback=Mock()
        from unittest.mock import patch
        with patch('traceback.print_exc'):recorder.supervise()
        self.assertEqual(recorder.fatal_error,'test disk error')
        recorder.close.assert_called_once();recorder.failure_callback.assert_called_once()
if __name__=='__main__': unittest.main()
