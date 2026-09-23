import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from trimbit_legacy.stats import ProxyUnavailable, fetch, parse

STATS = {
    "summary": {"mode": "cache", "primary_model": "claude-fable-5-1", "tip": "Set HEADROOM_MODE=token"},
    "requests": {
        "total": 167,
        "cached": 149,
        "failed": 1,
        "rate_limited": 0,
        "by_model": {"claude-fable-5-1": 72, "passthrough:count_tokens": 2},
    },
    "tokens": {"saved": 10_112_582, "all_layers_saved": 10_112_582, "all_layers_savings_percent": 9.61,
               "proxy_compression_saved": 2_324_390},
    "savings": {"by_layer": {"tool_search": {"tokens": 7_788_192}}},
    "latency": {"average_ms": 15594.34},
    "display_session": {
        "requests": 52, "tokens_saved": 1_032_860, "compression_savings_usd": 11.34, "cache_savings_usd": 84.13,
        "total_input_cost_usd": 91.8, "savings_percent": 3.59, "started_at": "2026-09-23T16:56:49Z",
    },
    "persistent_savings": {"lifetime": {"requests": 178, "tokens_saved": 2_352_186,
                                        "compression_savings_usd": 32.2, "cache_savings_usd": 245.4}},
}
HEALTH = {"status": "healthy", "version": "0.37.0", "uptime_seconds": 270991.5}


def test_parse_full_payload():
    s = parse(STATS, HEALTH)
    assert s.session.tokens_saved == 1_032_860
    assert s.session.total_usd == pytest.approx(95.47)
    assert s.session.savings_percent == 3.59
    assert s.session_started is not None
    assert s.lifetime.requests == 178
    assert s.lifetime.total_usd == pytest.approx(277.6)
    assert s.all_layers_saved == 10_112_582
    assert s.compression_saved == 2_324_390
    assert s.tool_search_saved == 7_788_192
    assert (s.requests_total, s.requests_cached, s.requests_failed) == (167, 149, 1)
    assert s.avg_latency_ms == 15594.34
    assert s.primary_model == "claude-fable-5-1"
    assert s.models == {"claude-fable-5-1": 72}
    assert s.version == "0.37.0" and s.healthy


def test_parse_tolerates_missing_and_odd_fields():
    s = parse({"tokens": None, "requests": "oops", "display_session": {"started_at": "bad"}})
    assert s.session.tokens_saved == 0
    assert s.session_started is None
    assert s.requests_total == 0
    assert s.version is None and s.healthy


def test_parse_falls_back_to_legacy_saved_key():
    assert parse({"tokens": {"saved": 42}}).all_layers_saved == 42


@pytest.fixture
def server():
    class Handler(BaseHTTPRequestHandler):
        routes = {"/stats": STATS, "/health": HEALTH}

        def do_GET(self):
            body = self.routes.get(self.path)
            self.send_response(200 if body is not None else 404)
            self.end_headers()
            self.wfile.write(json.dumps(body).encode() if body is not None else b"nope")

        def log_message(self, *args):
            pass

    httpd = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield httpd, Handler
    httpd.shutdown()


def test_fetch_roundtrip(server):
    httpd, _ = server
    s = fetch(f"http://127.0.0.1:{httpd.server_port}")
    assert s.session.requests == 52 and s.version == "0.37.0"


def test_fetch_without_health_endpoint(server):
    httpd, handler = server
    handler.routes = {"/stats": STATS}
    s = fetch(f"http://127.0.0.1:{httpd.server_port}")
    assert s.version is None and s.session.requests == 52


def test_fetch_unreachable():
    with pytest.raises(ProxyUnavailable):
        fetch("http://127.0.0.1:9", timeout=0.5)
