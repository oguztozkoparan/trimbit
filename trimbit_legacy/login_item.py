"""Launch-at-login via a per-user LaunchAgent (works without a signed helper)."""

from __future__ import annotations

import plistlib
import sys
from pathlib import Path

from trimbit_legacy import BUNDLE_ID

AGENT_PATH = Path.home() / "Library" / "LaunchAgents" / f"{BUNDLE_ID}.plist"


def app_bundle_path() -> Path | None:
    """Path to the enclosing .app when running from a py2app bundle, else None."""
    if getattr(sys, "frozen", None) != "macosx_app":
        return None
    for parent in Path(sys.executable).resolve().parents:
        if parent.suffix == ".app":
            return parent
    return None


def is_supported() -> bool:
    return app_bundle_path() is not None


def is_enabled() -> bool:
    return AGENT_PATH.exists()


def set_enabled(enabled: bool) -> None:
    if not enabled:
        AGENT_PATH.unlink(missing_ok=True)
        return
    bundle = app_bundle_path()
    if bundle is None:
        raise RuntimeError("Launch at Login is only available from the packaged app.")
    AGENT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with AGENT_PATH.open("wb") as fh:
        plistlib.dump(
            {
                "Label": BUNDLE_ID,
                "ProgramArguments": ["/usr/bin/open", "-a", str(bundle)],
                "RunAtLoad": True,
                "ProcessType": "Interactive",
            },
            fh,
        )
