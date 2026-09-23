//! User settings, persisted as JSON in the platform config directory.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::proxy::is_loopback_host;

pub const DEFAULT_PORT: u16 = 8787;
pub const REFRESH_CHOICES: [u64; 4] = [5, 10, 30, 60];
const DEFAULT_REFRESH: u64 = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TitleMode {
    SessionTokens,
    SessionUsd,
    LifetimeTokens,
    LifetimeUsd,
    IconOnly,
}

/// How token counts are shown: `1.1M` or `1,054,759`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NumberFormat {
    Compact,
    Exact,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Settings {
    pub host: String,
    pub port: u16,
    pub refresh_seconds: u64,
    pub title_mode: TitleMode,
    pub number_format: NumberFormat,
    pub notify_status_changes: bool,
    pub check_updates: bool,
}

impl Default for Settings {
    fn default() -> Self {
        let port = std::env::var("HEADROOM_PORT")
            .ok()
            .and_then(|p| p.trim().parse::<u16>().ok())
            .filter(|p| *p != 0)
            .unwrap_or(DEFAULT_PORT);
        Self {
            host: "127.0.0.1".into(),
            port,
            refresh_seconds: DEFAULT_REFRESH,
            title_mode: TitleMode::SessionTokens,
            number_format: NumberFormat::Compact,
            notify_status_changes: true,
            check_updates: true,
        }
    }
}

impl Settings {
    /// Rejects values the app must never act on. Used for updates coming from the UI.
    pub fn validate(&self) -> Result<(), String> {
        if !is_loopback_host(&self.host) {
            return Err(format!("Host “{}” is not a loopback address.", self.host));
        }
        if self.port == 0 {
            return Err("Port must be between 1 and 65535.".into());
        }
        if !REFRESH_CHOICES.contains(&self.refresh_seconds) {
            return Err(format!("Refresh interval must be one of {REFRESH_CHOICES:?} seconds."));
        }
        Ok(())
    }

    /// Replaces invalid fields with defaults. Used for settings read from disk.
    fn sanitized(mut self) -> Self {
        let default = Self::default();
        if !is_loopback_host(&self.host) {
            log::warn!("ignoring non-loopback host {:?} from settings file", self.host);
            self.host = default.host;
        }
        if self.port == 0 {
            self.port = default.port;
        }
        if !REFRESH_CHOICES.contains(&self.refresh_seconds) {
            self.refresh_seconds = default.refresh_seconds;
        }
        self
    }

    /// Loads settings; a missing file yields defaults, and an unreadable or
    /// corrupt one is moved aside (never deleted) before falling back to defaults.
    pub fn load(path: &Path) -> Self {
        let raw = match fs::read_to_string(path) {
            Ok(raw) => raw,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Self::default(),
            Err(e) => {
                log::warn!("could not read settings at {}: {e}", path.display());
                return Self::default();
            }
        };
        match serde_json::from_str::<Self>(&raw) {
            Ok(settings) => settings.sanitized(),
            Err(e) => {
                let backup = backup_path(path);
                log::warn!("settings file is invalid ({e}); moving it to {}", backup.display());
                if let Err(e) = fs::rename(path, &backup) {
                    log::warn!("could not back up invalid settings: {e}");
                }
                Self::default()
            }
        }
    }

    /// Atomic write: temp file in the same directory, fsync, then rename.
    pub fn save(&self, path: &Path) -> io::Result<()> {
        let dir = path.parent().ok_or_else(|| io::Error::other("settings path has no parent directory"))?;
        fs::create_dir_all(dir)?;
        let json = serde_json::to_vec_pretty(self).map_err(io::Error::other)?;
        let tmp = path.with_extension("json.tmp");
        {
            let mut file = fs::File::create(&tmp)?;
            file.write_all(&json)?;
            file.sync_all()?;
        }
        fs::rename(&tmp, path).inspect_err(|_| {
            let _ = fs::remove_file(&tmp);
        })
    }
}

fn backup_path(path: &Path) -> PathBuf {
    let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%S");
    path.with_extension(format!("corrupt-{stamp}.json"))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("settings.json");
        let s = Settings {
            port: 9000,
            refresh_seconds: 30,
            title_mode: TitleMode::SessionUsd,
            number_format: NumberFormat::Exact,
            ..Settings::default()
        };
        s.save(&path).unwrap();
        assert_eq!(Settings::load(&path), s);
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn missing_file_gives_defaults() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(Settings::load(&dir.path().join("none.json")), Settings::default());
    }

    #[test]
    fn corrupt_file_is_backed_up_not_deleted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(&path, "{not json").unwrap();
        assert_eq!(Settings::load(&path), Settings::default());
        assert!(!path.exists());
        let backups: Vec<_> = fs::read_dir(dir.path()).unwrap().collect();
        assert_eq!(backups.len(), 1);
    }

    #[test]
    fn unsafe_values_from_disk_are_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        fs::write(&path, r#"{"host": "evil.example.com", "port": 0, "refreshSeconds": 1}"#).unwrap();
        let s = Settings::load(&path);
        let d = Settings::default();
        assert_eq!((s.host, s.port, s.refresh_seconds), (d.host, d.port, d.refresh_seconds));
    }

    #[test]
    fn validate_rejects_bad_updates() {
        let ok = Settings::default();
        assert!(ok.validate().is_ok());
        assert!(Settings { host: "10.0.0.2".into(), ..ok.clone() }.validate().is_err());
        assert!(Settings { port: 0, ..ok.clone() }.validate().is_err());
        assert!(Settings { refresh_seconds: 1, ..ok }.validate().is_err());
    }
}
