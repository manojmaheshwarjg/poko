#!/usr/bin/env python3
"""Local static server for the dev harness and the fixtures.

    python3 dev/serve.py 4500            the harness and the mock Jira
    python3 dev/serve.py 4502 --cors     the exploration fixture, on its own origin
    python3 dev/serve.py 4501 --cors     core/*.js for trying the observer on a real page

Listens on 127.0.0.1 only, never on the network. Serves only the folders the harness
and the fixtures load: core, panel, fixture, plans, dev. Everything else in
the project answers 404, above all service/, which holds .env.local (the provider key)
and the database, and so does any dotfile anywhere. The check runs on the resolved
path, so ../ tricks resolve first and are refused like anything else outside.

--cors adds Access-Control-Allow-Origin: *, which the observer tests on real pages and
the cross-origin fixture need. It is safe only because of the allowlist above.
"""
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALLOWED = {"core", "panel", "fixture", "plans", "dev"}


def servable(handler, url_path):
    resolved = handler.translate_path(url_path)
    rel = os.path.relpath(resolved, ROOT)
    parts = [p for p in rel.split(os.sep) if p not in ("", ".")]
    if not parts or parts[0] == ".." or parts[0] not in ALLOWED:
        return False
    return not any(p.startswith(".") for p in parts)


def make_handler(cors):
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=ROOT, **kwargs)

        def send_head(self):
            if not servable(self, self.path):
                self.send_error(404, "Not served")
                return None
            return super().send_head()

        def end_headers(self):
            if cors:
                self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def log_message(self, fmt, *args):
            sys.stderr.write("%s - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), fmt % args))

    return Handler


def main(default_port=4500, cors=False):
    args = sys.argv[1:]
    port = next((int(a) for a in args if a.isdigit()), default_port)
    cors = cors or "--cors" in args
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler(cors))
    sys.stderr.write("serving %s on http://127.0.0.1:%d%s\n" % (", ".join(sorted(ALLOWED)), port, " with CORS" if cors else ""))
    server.serve_forever()


if __name__ == "__main__":
    main()
