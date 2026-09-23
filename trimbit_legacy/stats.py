"""Fetching and parsing Headroom proxy /stats and /health responses."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from trimbit_legacy import __version__
from trimbit_legacy.formatting import parse_iso

USER_AGENT = f"TrimbitLegacy/{__version__}"


class ProxyUnavailable(Exception):
    """Raised when the proxy can't be reached or returns something unusable."""


@dataclass(frozen=True)
class Savings:
    requests: int = 0
    tokens_saved: int = 0
    compression_usd: float = 0.0
    cache_usd: float = 0.0
    input_cost_usd: float = 0.0
    savings_percent: float | None = None

    @property
    def total_usd(self) -> float:
        return self.compression_usd + self.cache_usd


@dataclass(frozen=True)
class Snapshot:
    session: Savings
    lifetime: Savings
    session_started: datetime | None = None
    session_last_activity: datetime | None = None
    all_layers_saved: int = 0
    all_layers_percent: float | None = None
    compression_saved: int = 0
    tool_search_saved: int = 0
    requests_total: int = 0
    requests_cached: int = 0
    requests_failed: int = 0
    requests_rate_limited: int = 0
    avg_latency_ms: float | None = None
    mode: str | None = None
    primary_model: str | None = None
    tip: str | None = None
    version: str | None = None
    healthy: bool = True
    uptime_seconds: float | None = None
    models: dict[str, int] = field(default_factory=dict)


def _dig(data: Any, *path: str, default: Any = None) -> Any:
    for key in path:
        if not isinstance(data, dict):
            return default
        data = data.get(key)
    return default if data is None else data


def _savings(block: Any) -> Savings:
    return Savings(
        requests=int(_dig(block, "requests", default=0)),
        tokens_saved=int(_dig(block, "tokens_saved", default=0)),
        compression_usd=float(_dig(block, "compression_savings_usd", default=0.0)),
        cache_usd=float(_dig(block, "cache_savings_usd", default=0.0)),
        input_cost_usd=float(_dig(block, "total_input_cost_usd", default=0.0)),
        savings_percent=_dig(block, "savings_percent"),
    )


def parse(stats: dict[str, Any], health: dict[str, Any] | None = None) -> Snapshot:
    session_block = _dig(stats, "display_session") or _dig(stats, "persistent_savings", "display_session") or {}
    lifetime_block = _dig(stats, "persistent_savings", "lifetime") or {}
    health = health or {}
    tokens = _dig(stats, "tokens") or {}
    by_model = _dig(stats, "requests", "by_model") or {}
    return Snapshot(
        session=_savings(session_block),
        lifetime=_savings(lifetime_block),
        session_started=parse_iso(_dig(session_block, "started_at")),
        session_last_activity=parse_iso(_dig(session_block, "last_activity_at")),
        all_layers_saved=int(_dig(tokens, "all_layers_saved", default=_dig(tokens, "saved", default=0))),
        all_layers_percent=_dig(stats, "tokens", "all_layers_savings_percent"),
        compression_saved=int(_dig(stats, "tokens", "proxy_compression_saved", default=0)),
        tool_search_saved=int(_dig(stats, "savings", "by_layer", "tool_search", "tokens", default=0)),
        requests_total=int(_dig(stats, "requests", "total", default=0)),
        requests_cached=int(_dig(stats, "requests", "cached", default=0)),
        requests_failed=int(_dig(stats, "requests", "failed", default=0)),
        requests_rate_limited=int(_dig(stats, "requests", "rate_limited", default=0)),
        avg_latency_ms=_dig(stats, "latency", "average_ms"),
        mode=_dig(stats, "summary", "mode"),
        primary_model=_dig(stats, "summary", "primary_model"),
        tip=_dig(stats, "summary", "tip"),
        version=_dig(health, "version"),
        healthy=_dig(health, "status", default="healthy") == "healthy",
        uptime_seconds=_dig(health, "uptime_seconds"),
        models={k: v for k, v in by_model.items() if not k.startswith("passthrough:")},
    )


def _get_json(url: str, timeout: float) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.load(response)
    except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError) as exc:
        raise ProxyUnavailable(str(exc)) from exc
    if not isinstance(payload, dict):
        raise ProxyUnavailable(f"unexpected response from {url}")
    return payload


def fetch(base_url: str, timeout: float = 3.0) -> Snapshot:
    stats = _get_json(f"{base_url}/stats", timeout)
    try:
        health = _get_json(f"{base_url}/health", timeout)
    except ProxyUnavailable:
        health = None
    return parse(stats, health)
