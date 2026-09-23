"""User settings persisted as JSON in Application Support."""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, fields
from pathlib import Path

from trimbit_legacy import APP_NAME

SUPPORT_DIR = Path.home() / "Library" / "Application Support" / APP_NAME
SETTINGS_PATH = SUPPORT_DIR / "settings.json"

TITLE_MODES = {
    "session_tokens": "Session Tokens Saved",
    "session_usd": "Session Money Saved",
    "lifetime_tokens": "Lifetime Tokens Saved",
    "lifetime_usd": "Lifetime Money Saved",
    "icon_only": "Icon Only",
}
REFRESH_INTERVALS = (5, 10, 30, 60)


@dataclass
class Settings:
    host: str = "127.0.0.1"
    port: int = int(os.environ.get("HEADROOM_PORT", 8787))
    refresh_seconds: int = 10
    title_mode: str = "session_tokens"
    notify_status_changes: bool = True

    @property
    def base_url(self) -> str:
        return f"http://{self.host}:{self.port}"

    @classmethod
    def load(cls, path: Path = SETTINGS_PATH) -> Settings:
        settings = cls()
        try:
            data = json.loads(path.read_text())
        except (OSError, ValueError):
            return settings
        known = {f.name for f in fields(cls)}
        for key, value in data.items():
            if key in known and isinstance(value, type(getattr(settings, key))):
                setattr(settings, key, value)
        if settings.title_mode not in TITLE_MODES:
            settings.title_mode = cls.title_mode
        if not 1 <= settings.port <= 65535:
            settings.port = cls.port
        if settings.refresh_seconds < 1:
            settings.refresh_seconds = cls.refresh_seconds
        return settings

    def save(self, path: Path = SETTINGS_PATH) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(asdict(self), indent=2))
        tmp.replace(path)
