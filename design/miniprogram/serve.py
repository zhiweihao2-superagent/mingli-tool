"""本地预览静态服务：所有文件都发 no-store，避免改了脚本浏览器还跑旧的。

    python serve.py 8899
"""

from __future__ import annotations

import functools
import http.server
import socketserver
import sys
from pathlib import Path


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # 设计稿在迭代：HTML/JS/CSS 一律不缓存，刷新就是最新的
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):  # 少刷屏
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def main() -> int:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
    root = Path(__file__).resolve().parent
    handler = functools.partial(Handler, directory=str(root))
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", port), handler) as httpd:
        print(f"serving {root} at http://127.0.0.1:{port} (no-store)")
        httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
