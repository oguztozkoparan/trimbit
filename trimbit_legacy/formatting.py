"""Pure display helpers (no AppKit), so they can be unit tested."""

from __future__ import annotations

from datetime import datetime, timezone


def compact(n: float | int | None) -> str:
    """1234 -> '1.2K', 10112582 -> '10.1M'."""
    if n is None:
        return "–"
    n = float(n)
    sign = "-" if n < 0 else ""
    n = abs(n)
    for limit, suffix in ((1e12, "T"), (1e9, "B"), (1e6, "M"), (1e3, "K")):
        if n >= limit:
            value = n / limit
            text = f"{value:.0f}" if value >= 100 else f"{value:.1f}".rstrip("0").rstrip(".")
            return f"{sign}{text}{suffix}"
    return f"{sign}{n:.0f}"


def grouped(n: float | int | None) -> str:
    return "–" if n is None else f"{int(n):,}"


def usd(n: float | None) -> str:
    if n is None:
        return "–"
    if abs(n) >= 1000:
        return f"${n:,.0f}"
    return f"${n:,.2f}"


def percent(n: float | None) -> str:
    return "–" if n is None else f"{n:.1f}%"


def duration(seconds: float | None) -> str:
    """Human duration: '45s', '18m', '3h 12m', '3d 4h'."""
    if seconds is None or seconds < 0:
        return "–"
    s = int(seconds)
    days, s = divmod(s, 86400)
    hours, s = divmod(s, 3600)
    minutes, s = divmod(s, 60)
    if days:
        return f"{days}d {hours}h"
    if hours:
        return f"{hours}h {minutes}m"
    if minutes:
        return f"{minutes}m"
    return f"{s}s"


def millis(ms: float | None) -> str:
    if ms is None:
        return "–"
    return f"{ms / 1000:.1f} s" if ms >= 1000 else f"{ms:.0f} ms"


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def since(dt: datetime | None, now: datetime | None = None) -> str:
    """'16:56 (18m ago)' in local time."""
    if dt is None:
        return "–"
    now = now or datetime.now(timezone.utc)
    local = dt.astimezone()
    return f"{local:%H:%M} ({duration((now - dt).total_seconds())} ago)"
