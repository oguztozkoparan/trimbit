# Trimbit Legacy

> [!WARNING]
> **Deprecated: old macOS-only version.** This Python/rumps app is kept for reference under the
> `v1.0.0-macos-legacy` tag. It is being replaced by **Trimbit**, a cross-platform (macOS, Windows, Linux)
> rewrite in Tauri 2, and receives no further updates.

A macOS menu bar monitor for the [Headroom](https://github.com/chopratejas/headroom) optimization proxy.
It polls the proxy's `/stats` and `/health` endpoints and shows how many tokens and dollars Headroom is saving you.

## Features

- **Menu bar readout**: session tokens saved, session $ saved, lifetime tokens/$, or icon only
- **Session, lifetime and proxy sections**: tokens saved and savings %, compression vs cache savings, requests,
  cache hits, failures, average latency, top model, proxy mode and optimization tips
- **Live status**: green/red indicator with the proxy version and uptime; the icon changes when the proxy is offline,
  and the last known data stays visible
- **Notifications** when the proxy goes down or comes back (packaged app only)
- **Open Dashboard** (⌘D), **Refresh Now** (⌘R), **Copy Summary** (⌘C)
- **Settings**: refresh interval, proxy port and launch at login, saved to
  `~/Library/Application Support/Trimbit Legacy/settings.json`
- Network calls run off the main thread, so the menu never freezes. Logs go to `~/Library/Logs/Trimbit Legacy/`.

## Requirements

- macOS 12 or later
- Python 3.10 or later
- A running Headroom proxy (`headroom proxy`, default `127.0.0.1:8787`; `HEADROOM_PORT` is respected)

## Development

```sh
make venv      # create .venv and install dev dependencies
make run       # run from source
make test      # run the unit tests
make lint      # run ruff
```

## Building the app

```sh
make app       # builds "dist/Trimbit Legacy.app" (regenerates resources/AppIcon.icns)
make install   # copies it to /Applications
```

Launch at Login is only available in the packaged app. It installs a LaunchAgent at
`~/Library/LaunchAgents/io.github.oguztozkoparan.trimbitlegacy.plist`.

## Project layout

```
trimbit_legacy/
  app.py          rumps/AppKit menu bar UI
  stats.py        /stats + /health client and parsing
  formatting.py   number, currency and duration formatting
  config.py       persisted settings
  login_item.py   launch at login (LaunchAgent)
scripts/make_icon.py   renders the app icon from an SF Symbol
tests/                 pytest suite
```
