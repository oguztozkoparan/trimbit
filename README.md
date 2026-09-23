<p align="center">
  <img src="branding/png/lockup-light-bg@2x.png#gh-light-mode-only" alt="Trimbit" width="320">
  <img src="branding/png/lockup-dark-bg@2x.png#gh-dark-mode-only" alt="Trimbit" width="320">
</p>

<p align="center"><b>An unofficial menu bar companion for <a href="https://github.com/chopratejas/headroom">Headroom</a>.</b><br>
Live token and cost savings from your local Headroom proxy, on macOS, Windows and Linux.</p>

> Trimbit is an independent project. It is not affiliated with or endorsed by the Headroom project.

<p align="center">
  <img src="docs/screenshots/panel-online.png" width="260" alt="Session savings panel">
  <img src="docs/screenshots/panel-offline.png" width="260" alt="Proxy offline state">
  <img src="docs/screenshots/panel-method.png" width="260" alt="How savings are calculated">
</p>

## Features

- **Savings at a glance**: the tray shows session tokens or dollars saved (your choice), or just the icon.
- **Panel**: click the tray icon to open it.
  - This session: estimated savings split into Headroom compression and the provider's prompt-cache discount,
    plus tokens compressed and savings %.
  - **How savings are calculated**: the formula behind each dollar figure, the pricing source, and a clear
    warning when Headroom is falling back to a flat rate.
  - Lifetime savings and all-layer token savings.
  - Requests and cache hit rate, average latency, and where the tokens were saved (tool schemas vs. compression).
  - Top models, plus Headroom's own optimization tips.
- **Honest status**: online, degraded or offline, with proxy version and uptime. When the proxy goes away, the last
  known data stays visible and is clearly marked as stale.
- **Notifications** when the proxy goes down or comes back.
- **Quick actions**: open the Headroom dashboard, copy a plain-text summary, refresh (⌘/Ctrl+R).
- **Exact or short numbers**: `1.1M` or `1,054,759`. In short mode, hover any count to see the exact value.
- **Settings**: tray display, number format, refresh interval (5 to 60 s), proxy port, notifications, launch at
  login.
- **Native look**: Liquid Glass on macOS 26+ (vibrancy on older macOS), Fluent Acrylic on Windows and an
  opaque panel on Linux, with corner and control shapes that follow each platform.
- Light and dark themes, keyboard navigation and reduced-motion support.

## Install

Download the installer for your platform from the [Releases](../../releases) page:

| Platform | File |
|---|---|
| macOS (Apple silicon / Intel) | `Trimbit_<version>_aarch64.dmg` / `Trimbit_<version>_x64.dmg` |
| Windows 10/11 | `Trimbit_<version>_x64-setup.exe` or `.msi` |
| Linux | `.AppImage`, `.deb` or `.rpm` |

Then start Headroom (`headroom proxy`, default `127.0.0.1:8787`) and launch Trimbit.

<details>
<summary>Platform notes</summary>

- **macOS**: until builds are signed and notarized, Gatekeeper will warn on first launch. Right-click the app,
  choose **Open**, and confirm.
- **Windows**: tray icons can't show text, so hover the icon for a summary. SmartScreen may warn until the
  installer is code-signed.
- **Linux**: needs an AppIndicator-capable panel. On GNOME, install the *AppIndicator and KStatusNotifierItem
  Support* extension. The tray icon doesn't receive clicks there, so open the panel from the tray menu
  (**Open Trimbit**).

</details>

## Privacy and security

Trimbit only ever talks to a Headroom proxy on your own machine.

- **Network**: requests go only to loopback addresses (`127.0.0.1`, `localhost`, `::1`), and this is enforced in
  code. Redirects, system proxies and responses over 2 MB are refused.
- **No telemetry, no accounts, no secrets.** Trimbit ignores credentials that appear in Headroom's stats and
  never displays, logs or copies them.
- **Least privilege**: the UI can call only the eight commands Trimbit defines. It has no filesystem, shell or
  network access, and runs under a strict Content Security Policy.
- **Local data** (settings, logs capped at about 2 MB) stays in the standard per-user app directories.

See [SECURITY.md](SECURITY.md) for the full threat model and how to report a vulnerability.

## Development

Requirements: [Rust](https://rustup.rs) (the toolchain is pinned in `rust-toolchain.toml`), Node.js 20.19 or
later, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```sh
npm install
npm run app:dev        # run the app with hot reload
npm run app:build      # production build and installers in src-tauri/target/release/bundle/
```

Checks (all of these run in CI on macOS, Windows and Linux):

```sh
npm run typecheck && npm test                                   # frontend
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

UI work without the backend: run `npm run dev` and open
`http://127.0.0.1:1420/preview/?state=online` (`offline`, `stale`, `connecting`; add `&view=settings` or
`&theme=light`, `&platform=windows`, `&material=glass`). The preview mocks the IPC layer with sample data.

### Layout

```
src/                 panel UI (TypeScript, no framework)
src-tauri/src/
  proxy.rs           loopback-only HTTP client and tolerant /stats parser
  settings.rs        validated settings with atomic writes
  state.rs           shared state and the payload sent to the UI
  tray.rs            tray icon, menu and panel positioning
  material.rs        native panel material per OS
  actions.rs         actions shared by the tray menu and IPC commands
  lib.rs             IPC commands, polling loop, plugin setup
src-tauri/capabilities/panel.json   the UI's entire permission set
branding/            brand kit and its generator (see branding/BRAND.md)
preview/             dev-only mocked UI preview
```

## Releasing

1. Bump `version` in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`.
2. Tag and push, for example `git tag v2.0.1 && git push --tags`.
3. The Release workflow builds every platform and opens a **draft** GitHub release for review.

Code signing is optional and switches on when the `APPLE_*` repository secrets are set (see
`.github/workflows/release.yml`). Keep certificates and passwords in GitHub secrets or your keychain, never in
the repository.

## History

Trimbit 2 replaces an earlier macOS-only Python version, archived under the
[`v1.0.0-macos-legacy`](../../tree/v1.0.0-macos-legacy) tag and deprecated.

## License

[Apache-2.0](LICENSE). The Trimbit name and logo are not covered by the license (see [NOTICE](NOTICE)).
The Space Grotesk font in `branding/fonts/` is under the SIL Open Font License 1.1.
