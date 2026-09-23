# Security

## Reporting a vulnerability

Please report security issues privately via
[GitHub Security Advisories](../../security/advisories/new) instead of opening a public issue. Include steps to
reproduce and the affected version. You should get a reply within a few days.

## Threat model

Trimbit is a read-only monitor for a Headroom proxy on the same machine. It must never become a way to reach
other hosts, run code, or leak data, even when the proxy or the settings file is hostile.

| Input | Trust | Controls |
|---|---|---|
| Proxy HTTP responses | Untrusted | Only loopback hosts are allowed, and the check runs before any connection. No redirects and no system proxy. 4 s timeout, 2 MB body cap. JSON is parsed tolerantly into a fixed schema, so unknown fields are dropped. Strings are stripped of control and bidi-override characters and capped at 200 characters. |
| Settings file on disk | Untrusted | Parsed with `deny_unknown_fields`. Non-loopback hosts, zero ports and unsupported intervals fall back to defaults. A corrupt file is moved aside, never deleted. |
| Settings changes from the UI | Validated | Same validation, but invalid values are rejected with an error instead of being replaced. Nothing is saved or applied unless every field is valid. |
| Web UI | Sandboxed | It can call only the 8 app commands listed in `src-tauri/build.rs` and `capabilities/panel.json`. No filesystem, shell, HTTP or window APIs. CSP is `default-src 'none'` with only same-origin scripts and styles, and the prototype is frozen. All text is inserted with `textContent`, never `innerHTML`. |

### Sensitive data

- Headroom's `/stats` includes a credential prefix (`subscription_window.latest.token_prefix`). Trimbit never
  reads that field. It is not deserialized, displayed, logged or copied, and a unit test enforces this.
- Logs record only status transitions and error messages. They contain no request or response bodies, and file
  size is capped with rotation.
- The **Copy Summary** text contains only aggregate numbers.

### Robustness

- No `unwrap`, `expect` or `panic` in application code (clippy `deny`). `unsafe` is denied crate-wide, with one
  audited exception in `material.rs`: casting Tauri's `NSWindow` pointer to attach Liquid Glass on the main
  thread.
- The UI shows proxy failures as state; they are never fatal. A poisoned lock is recovered instead of crashing.
- Settings are written atomically (temp file, fsync, rename).
- Only one instance runs at a time. Launching again focuses the existing panel.

### Supply chain

- Dependencies are locked (`Cargo.lock`, `package-lock.json`) and CI installs with `--locked` / `npm ci`.
- CI runs `cargo audit` (RustSec) and `npm audit`. Dependabot proposes weekly updates.
- GitHub Actions are pinned to commit SHAs.
- The frontend has one runtime dependency, `@tauri-apps/api`.

### Known limitations

- Release builds are unsigned until signing secrets are configured, so users must bypass Gatekeeper or
  SmartScreen warnings on first launch.
- `macOSPrivateApi` is enabled for the panel's transparent window. That rules out the Mac App Store but doesn't
  affect direct distribution.
