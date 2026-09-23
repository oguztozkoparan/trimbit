//! Shared application state and the payload sent to the panel.

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};
use std::time::Instant;

use chrono::{DateTime, Utc};
use serde::Serialize;
use tokio::sync::Notify;

use crate::format;
use crate::proxy::{self, Snapshot};
use crate::settings::Settings;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Connecting,
    Online,
    Degraded,
    Offline,
}

impl Status {
    pub fn is_up(self) -> bool {
        matches!(self, Status::Online | Status::Degraded)
    }
}

pub struct Inner {
    pub settings: Settings,
    pub snapshot: Option<Snapshot>,
    pub status: Status,
    pub error: Option<String>,
    pub last_checked: Option<DateTime<Utc>>,
    pub last_success: Option<DateTime<Utc>>,
    pub panel_hidden_at: Option<Instant>,
}

pub struct AppState {
    inner: Mutex<Inner>,
    pub refresh: Notify,
    pub client: proxy::Client,
    pub settings_path: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatePayload {
    pub status: Status,
    pub error: Option<String>,
    pub snapshot: Option<Snapshot>,
    pub settings: Settings,
    pub base_url: String,
    pub last_checked: Option<DateTime<Utc>>,
    pub last_success: Option<DateTime<Utc>>,
    pub launch_at_login: bool,
    pub app_version: &'static str,
    pub platform: &'static str,
    pub material: &'static str,
}

impl AppState {
    pub fn new(settings: Settings, client: proxy::Client, settings_path: PathBuf) -> Self {
        Self {
            inner: Mutex::new(Inner {
                settings,
                snapshot: None,
                status: Status::Connecting,
                error: None,
                last_checked: None,
                last_success: None,
                panel_hidden_at: None,
            }),
            refresh: Notify::new(),
            client,
            settings_path,
        }
    }

    /// A poisoned lock only means another thread panicked mid-update; the data
    /// is still usable, so recover it instead of propagating the panic.
    pub fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn payload(&self, launch_at_login: bool) -> StatePayload {
        let inner = self.lock();
        StatePayload {
            status: inner.status,
            error: inner.error.clone(),
            snapshot: inner.snapshot.clone(),
            settings: inner.settings.clone(),
            base_url: proxy::base_url(&inner.settings.host, inner.settings.port).unwrap_or_default(),
            last_checked: inner.last_checked,
            last_success: inner.last_success,
            launch_at_login,
            app_version: env!("CARGO_PKG_VERSION"),
            platform: std::env::consts::OS,
            material: crate::material::current(),
        }
    }
}

/// Plain-text summary for the clipboard. Never includes anything from the proxy
/// beyond numbers, so it is safe to paste anywhere.
pub fn summary_text(inner: &Inner) -> String {
    let Some(s) = inner.snapshot.as_ref() else {
        return format!("Headroom proxy offline (port {})", inner.settings.port);
    };
    format!(
        "Headroom savings (via Trimbit)\n\
         Session: {} tokens removed ({} of input), ≈ {} estimated value, {} requests\n\
         Lifetime: {} tokens removed, ≈ {} estimated value, {} requests\n\
         Proxy, all layers: {} tokens saved ({})",
        format::grouped(s.session.tokens_saved),
        format::percent(s.session.savings_percent),
        format::usd(s.session.compression_usd),
        format::grouped(s.session.requests),
        format::grouped(s.lifetime.tokens_saved),
        format::usd(s.lifetime.compression_usd),
        format::grouped(s.lifetime.requests),
        format::grouped(s.all_layers_saved),
        format::percent(s.all_layers_percent),
    )
}
