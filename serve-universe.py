"""Serve the local artwork independently of a terminal window."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys

root = Path(__file__).resolve().parent
log_dir = root / 'work'
log_dir.mkdir(exist_ok=True)
log = (log_dir / 'server-errors.log').open('a', encoding='utf-8', buffering=1)
sys.stdout = log
sys.stderr = log
handler = partial(SimpleHTTPRequestHandler, directory=str(root / 'outputs'))
with ThreadingHTTPServer(('127.0.0.1', 8765), handler) as server:
    server.daemon_threads = True
    print('Sonic Universe ready at http://127.0.0.1:8765/', flush=True)
    server.serve_forever()
