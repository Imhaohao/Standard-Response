"""HTTP solver service. Convex's dispatcher posts each re-solve here and falls back to its own
heuristic when this service is slow or down.

    uv run python server.py            # http://127.0.0.1:8799
    POST /solve   problem JSON (see solver.py)  ->  routes JSON
    GET  /health  -> {"ok": true}

Problems carry riders' home coordinates. When SOLVER_TOKEN is set, /solve requires
"Authorization: Bearer <SOLVER_TOKEN>"; set the same value in Convex (`npx convex env set SOLVER_TOKEN ...`).
"""

import hmac
import json
import os
import sys
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import heuristic
import solver

POLICIES = {"ortools": solver.solve, "heuristic": heuristic.solve}
MAX_BODY_BYTES = 20_000_000
TOKEN = os.environ.get("SOLVER_TOKEN", "")


def authorized(header: str | None) -> bool:
    if not TOKEN:
        return True
    return hmac.compare_digest(header or "", f"Bearer {TOKEN}")


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, payload: dict):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"ok": True})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/solve":
            self._send(404, {"error": "not found"})
            return
        if not authorized(self.headers.get("Authorization")):
            self._send(401, {"error": "missing or wrong token"})
            return
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0 or length > MAX_BODY_BYTES:
            self._send(413, {"error": "body missing or too large"})
            return
        try:
            problem = json.loads(self.rfile.read(length))
            policy = POLICIES.get(problem.get("policy", "ortools"), solver.solve)
            self._send(200, policy(problem))
        except (KeyError, TypeError, ValueError) as error:
            self._send(400, {"error": f"bad problem: {error}"})
        except Exception:  # noqa: BLE001 - report solver crashes to the caller, which falls back
            traceback.print_exc()
            self._send(500, {"error": "solver crashed"})

    def log_message(self, fmt, *args):
        sys.stderr.write(f"{self.address_string()} {fmt % args}\n")


def main():
    host = os.environ.get("SOLVER_HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8799"))
    print(f"solver listening on http://{host}:{port}", flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
