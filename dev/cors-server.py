#!/usr/bin/env python3
"""The dev static server with CORS on, kept so older commands still work:

    python3 dev/cors-server.py 4501

Same rules as dev/serve.py: 127.0.0.1 only, and only the folders the harness and the
fixtures load. It used to serve the whole project, service/.env.local included.
"""
from serve import main

if __name__ == "__main__":
    main(default_port=4501, cors=True)
