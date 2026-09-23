import json

from trimbit_legacy.config import Settings


def test_roundtrip(tmp_path):
    path = tmp_path / "settings.json"
    s = Settings(port=9000, title_mode="session_usd", refresh_seconds=30)
    s.save(path)
    loaded = Settings.load(path)
    assert (loaded.port, loaded.title_mode, loaded.refresh_seconds) == (9000, "session_usd", 30)
    assert loaded.base_url == "http://127.0.0.1:9000"


def test_invalid_values_fall_back(tmp_path):
    path = tmp_path / "settings.json"
    path.write_text(json.dumps({"port": 99999, "title_mode": "bogus", "refresh_seconds": "fast", "extra": 1}))
    loaded = Settings.load(path)
    default = Settings()
    assert (loaded.port, loaded.title_mode, loaded.refresh_seconds) == (default.port, default.title_mode, 10)


def test_missing_or_corrupt_file(tmp_path):
    assert Settings.load(tmp_path / "nope.json") == Settings()
    bad = tmp_path / "bad.json"
    bad.write_text("{not json")
    assert Settings.load(bad) == Settings()
