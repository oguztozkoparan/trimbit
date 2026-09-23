"""Build the macOS app bundle: `python setup.py py2app` (see Makefile)."""

from pathlib import Path

from setuptools import setup

from trimbit_legacy import APP_NAME, BUNDLE_ID, __version__

ICON = Path("resources/AppIcon.icns")

OPTIONS = {
    "argv_emulation": False,
    "iconfile": str(ICON) if ICON.exists() else None,
    "packages": ["trimbit_legacy", "rumps"],
    "includes": ["AppKit", "Foundation", "PyObjCTools.AppHelper"],
    "excludes": ["tkinter", "PyQt6", "unittest", "pydoc", "test"],
    "plist": {
        "CFBundleName": APP_NAME,
        "CFBundleDisplayName": APP_NAME,
        "CFBundleIdentifier": BUNDLE_ID,
        "CFBundleVersion": __version__,
        "CFBundleShortVersionString": __version__,
        "LSUIElement": True,
        "LSMinimumSystemVersion": "12.0",
        "NSHumanReadableCopyright": "© Mehmet Oğuz Tozkoparan",
        # Allow plain-http requests to the local proxy.
        "NSAppTransportSecurity": {"NSAllowsLocalNetworking": True},
    },
}

setup(
    name=APP_NAME,
    version=__version__,
    app=["main.py"],
    options={"py2app": {k: v for k, v in OPTIONS.items() if v is not None}},
)
