#!/usr/bin/env python3
"""Локальный сервер для предпросмотра сайта.

Отличие от `python -m http.server`: поддерживает Range-запросы,
поэтому в браузере корректно работает перемотка аудио.

Запуск:  python serve.py [порт]   (по умолчанию 8000)
"""
import http.server
import os
import re
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
ROOT = os.path.dirname(os.path.abspath(__file__))


class RangeHandler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        rng = self.headers.get("Range")
        if rng:
            m = re.match(r"bytes=(\d*)-(\d*)\s*$", rng.strip())
            path = self.translate_path(self.path)
            if m and not os.path.isdir(path):
                try:
                    f = open(path, "rb")
                except OSError:
                    self.send_error(404, "File not found")
                    return None
                size = os.fstat(f.fileno()).st_size
                g1, g2 = m.group(1), m.group(2)
                if g1 == "" and g2 == "":
                    f.close()
                    return super().send_head()
                if g1 == "":
                    length = int(g2)
                    start = max(0, size - length)
                    end = size - 1
                else:
                    start = int(g1)
                    end = min(int(g2), size - 1) if g2 else size - 1
                if start >= size or start > end:
                    f.close()
                    self.send_error(416, "Range Not Satisfiable")
                    return None
                self.send_response(206)
                self.send_header("Content-Type", self.guess_type(path))
                self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
                self.send_header("Content-Length", str(end - start + 1))
                self.end_headers()
                f.seek(start)
                return _Limited(f, end - start + 1)
        return super().send_head()

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()


class _Limited:
    """Обёртка файла: отдаёт не больше remaining байт."""

    def __init__(self, f, remaining):
        self.f = f
        self.remaining = remaining

    def read(self, n=-1):
        if self.remaining <= 0:
            return b""
        if n is None or n < 0 or n > self.remaining:
            n = self.remaining
        data = self.f.read(n)
        self.remaining -= len(data)
        return data

    def close(self):
        self.f.close()


if __name__ == "__main__":
    os.chdir(ROOT)
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), RangeHandler) as httpd:
        print(f"http://127.0.0.1:{PORT}/  (Range-запросы: вкл)")
        httpd.serve_forever()
