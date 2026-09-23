//! Signed self-updates from GitHub Releases.
//!
//! The only non-loopback network access Trimbit makes. Updates are verified against the
//! public key in tauri.conf.json before anything is installed, and checks can be turned off.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::state::AppState;
use crate::tray;

const FIRST_CHECK_DELAY: Duration = Duration::from_secs(20);
const CHECK_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum UpdateStatus {
    #[default]
    Idle,
    Checking,
    UpToDate,
    Available {
        version: String,
    },
    Installing {
        version: String,
    },
    Failed {
        message: String,
    },
}

/// The update found by the last check, kept so "Install" doesn't have to fetch it again.
#[derive(Default)]
pub struct Pending(Mutex<Option<Update>>);

fn app_state(app: &AppHandle) -> Arc<AppState> {
    app.state::<Arc<AppState>>().inner().clone()
}

fn set_status(app: &AppHandle, status: UpdateStatus) {
    let state = app_state(app);
    {
        let mut inner = state.lock();
        inner.update = status;
        tray::update(app, &inner);
    }
    if let Err(e) = app.emit_to(tray::PANEL, "state", crate::actions::payload(app)) {
        log::debug!("could not emit state: {e}");
    }
}

/// Checks GitHub for a newer release. `manual` checks run even when automatic checks are off
/// and report "up to date"; background checks stay silent unless something is found.
pub async fn check(app: &AppHandle, manual: bool) {
    let enabled = app_state(app).lock().settings.check_updates;
    if !manual && !enabled {
        return;
    }
    if manual {
        set_status(app, UpdateStatus::Checking);
    }
    let result = match app.updater() {
        Ok(updater) => updater.check().await,
        Err(e) => Err(e),
    };
    match result {
        Ok(Some(update)) => {
            log::info!("update available: {} -> {}", update.current_version, update.version);
            let version = update.version.clone();
            *app.state::<Pending>().0.lock().unwrap_or_else(|p| p.into_inner()) = Some(update);
            set_status(app, UpdateStatus::Available { version });
        }
        Ok(None) => set_status(app, if manual { UpdateStatus::UpToDate } else { UpdateStatus::Idle }),
        Err(e) => {
            log::warn!("update check failed: {e}");
            if manual {
                set_status(
                    app,
                    UpdateStatus::Failed { message: "Couldn't check for updates. Try again later.".into() },
                );
            }
        }
    }
}

/// Downloads, verifies and installs the pending update, then restarts Trimbit.
pub async fn install(app: &AppHandle) {
    let Some(update) = app.state::<Pending>().0.lock().unwrap_or_else(|p| p.into_inner()).take() else {
        return;
    };
    let version = update.version.clone();
    set_status(app, UpdateStatus::Installing { version: version.clone() });
    match update.download_and_install(|_, _| {}, || {}).await {
        Ok(()) => {
            log::info!("installed update {version}; restarting");
            app.restart();
        }
        Err(e) => {
            log::warn!("update install failed: {e}");
            let message = if cfg!(target_os = "linux") {
                "Couldn't install the update. Self-update works with the AppImage; for .deb or .rpm, download the new version from the website."
            } else {
                "Couldn't install the update. Download it from the website instead."
            };
            set_status(app, UpdateStatus::Failed { message: message.into() });
        }
    }
}

pub async fn check_loop(app: AppHandle) {
    tokio::time::sleep(FIRST_CHECK_DELAY).await;
    loop {
        check(&app, false).await;
        tokio::time::sleep(CHECK_INTERVAL).await;
    }
}
