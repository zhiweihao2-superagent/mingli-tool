from __future__ import annotations

import json
import sys
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from mingli_tool.web import create_server  # noqa: E402


class WebServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = create_server("127.0.0.1", 0)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def read_json(self, request):
        with urlopen(request, timeout=5) as response:
            return response.status, json.loads(response.read().decode("utf-8"))

    def test_serves_workbench(self):
        with urlopen(f"{self.base_url}/", timeout=5) as response:
            body = response.read().decode("utf-8")
            status = response.status
            frame_policy = response.headers["X-Frame-Options"]
        self.assertEqual(status, 200)
        self.assertIn("命理工具 · 八字与紫微斗数", body)
        # 首屏标题与页头导航是页面骨架的一部分：改了文案就要同步这里
        self.assertIn("出生时刻，排成一张可核对的表", body)
        self.assertIn('id="open-archive"', body)
        self.assertIn('id="archive-dialog"', body)
        self.assertEqual(frame_policy, "DENY")

    def test_health_endpoint(self):
        status, body = self.read_json(f"{self.base_url}/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["schema_version"], "1.0")

    def test_calculates_with_real_engine(self):
        payload = json.loads((ROOT / "examples" / "bazi_known_time.json").read_text(encoding="utf-8"))
        request = Request(
            f"{self.base_url}/api/v1/bazi/calculate",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        status, body = self.read_json(request)
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "ok")
        self.assertEqual(body["calculation"]["pillars"]["day"]["ganzhi"], "庚辰")

    def test_rejects_invalid_json(self):
        request = Request(
            f"{self.base_url}/api/v1/bazi/calculate",
            data=b"{",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with self.assertRaises(HTTPError) as raised:
            urlopen(request, timeout=5)
        self.assertEqual(raised.exception.code, 400)
        body = json.loads(raised.exception.read().decode("utf-8"))
        self.assertEqual(body["error"]["code"], "INVALID_JSON")



if __name__ == "__main__":
    unittest.main()
