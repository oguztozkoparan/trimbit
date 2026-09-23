from datetime import datetime, timedelta, timezone

from trimbit_legacy import formatting as fmt


def test_compact():
    assert fmt.compact(None) == "–"
    assert fmt.compact(0) == "0"
    assert fmt.compact(999) == "999"
    assert fmt.compact(1000) == "1K"
    assert fmt.compact(1234) == "1.2K"
    assert fmt.compact(10_112_582) == "10.1M"
    assert fmt.compact(245_000_000) == "245M"
    assert fmt.compact(-1500) == "-1.5K"


def test_usd_and_percent():
    assert fmt.usd(None) == "–"
    assert fmt.usd(11.342) == "$11.34"
    assert fmt.usd(1234.5) == "$1,234"
    assert fmt.percent(3.587) == "3.6%"


def test_duration_and_millis():
    assert fmt.duration(None) == "–"
    assert fmt.duration(45) == "45s"
    assert fmt.duration(18 * 60 + 5) == "18m"
    assert fmt.duration(3 * 3600 + 12 * 60) == "3h 12m"
    assert fmt.duration(270_991) == "3d 3h"
    assert fmt.millis(289.1) == "289 ms"
    assert fmt.millis(15_594.3) == "15.6 s"


def test_parse_iso_and_since():
    dt = fmt.parse_iso("2026-09-23T16:56:49Z")
    assert dt == datetime(2026, 9, 23, 16, 56, 49, tzinfo=timezone.utc)
    assert fmt.parse_iso("nonsense") is None
    assert fmt.parse_iso(None) is None
    assert fmt.since(dt, now=dt + timedelta(minutes=18)).endswith("(18m ago)")
