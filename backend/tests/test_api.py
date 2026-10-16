"""Exercise the job API with a small real video; isolate model inference in unit tests."""
import tempfile
import time
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
import imageio_ffmpeg
from backend import server


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.root = Path(cls.directory.name)
        source = cls.root / 'fixture.mp4'
        subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-v', 'error', '-f', 'lavfi',
                        '-i', 'testsrc2=size=160x90:rate=25:duration=2', '-c:v', 'libx264', str(source)], check=True)
        cls.video = source.read_bytes()

    @classmethod
    def tearDownClass(cls):
        server.executor.submit(lambda: None).result(timeout=10)
        cls.directory.cleanup()

    def setUp(self):
        self.patch = patch.object(server, 'DATA', self.root)
        self.patch.start()
        self.client = TestClient(server.app)

    def tearDown(self):
        server.executor.submit(lambda: None).result(timeout=10)
        self.client.close()
        self.patch.stop()

    def upload(self, query=''):
        return self.client.post('/api/jobs' + query, files={'file': ('fixture.mp4', self.video, 'video/mp4')})

    def wait(self, job_id, statuses):
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            status = self.client.get(f'/api/jobs/{job_id}').json()
            if status['status'] in statuses:
                return status
            time.sleep(.02)
        self.fail(f'Job did not finish: {status}')

    def test_rejects_external_origin_and_host(self):
        self.assertEqual(self.client.get('/api/health', headers={'origin': 'https://example.com'}).status_code, 403)
        self.assertEqual(self.client.get('/api/health', headers={'host': 'external.example'}).status_code, 403)
        self.assertEqual(self.client.get('/api/health').json()['scoreboardUsed'], False)

    def test_rejects_bad_ranges_and_non_video(self):
        for query in ['?start=-1', '?start=nan', '?end=inf', '?start=1&end=0.5', '?start=3']:
            self.assertEqual(self.upload(query).status_code, 422, query)
        self.assertEqual(self.client.post('/api/jobs', files={'file': ('bad.mp4', b'not a video')}).status_code, 422)

    def test_result_export_and_download_lifecycle(self):
        result = {'metadata': {'version': '2.0'}, 'rallies': [], 'frames': []}
        with patch.object(server, 'analyze', return_value=result):
            response = self.upload('?start=0&end=1.5')
            self.assertEqual(response.status_code, 202)
            job_id = response.json()['id']
            self.assertEqual(self.wait(job_id, {'complete', 'failed'})['status'], 'complete')
        self.assertEqual(self.client.get(f'/api/jobs/{job_id}/result').json()['metadata']['sourceFile'], 'fixture.mp4')
        self.assertEqual(self.client.get(f'/api/jobs/{job_id}/video').status_code, 409)
        self.assertEqual(self.client.post(f'/api/jobs/{job_id}/export', json={'clips': [{'start': 0, 'end': 3}]}).status_code, 422)
        self.assertEqual(self.client.post(f'/api/jobs/{job_id}/export', json={'clips': [{'start': .3, 'end': .9}]}).status_code, 202)
        self.assertEqual(self.wait(job_id, {'exported', 'complete'})['status'], 'exported')
        download = self.client.get(f'/api/jobs/{job_id}/video')
        self.assertEqual(download.status_code, 200)
        self.assertEqual(download.headers['content-type'], 'video/mp4')
        self.assertGreater(len(download.content), 1000)

    def test_cancelled_analysis_does_not_publish_result(self):
        def work(_path, _start, _end, _progress, cancel):
            if cancel.wait(5):
                raise InterruptedError()
            self.fail('Cancellation did not reach the worker')
        with patch.object(server, 'analyze', side_effect=work):
            job_id = self.upload().json()['id']
            self.assertEqual(self.client.delete(f'/api/jobs/{job_id}').status_code, 200)
            self.assertEqual(self.wait(job_id, {'cancelled', 'failed'})['status'], 'cancelled')
            self.assertEqual(self.client.get(f'/api/jobs/{job_id}/result').status_code, 409)


if __name__ == '__main__':
    unittest.main()
