//! Actions shared by the tray menu and the panel's IPC commands.

use std::sync::Arc;

use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_clipboard_manager::ClipboardExt as _;
use tauri_plugin_opener::OpenerExt as _;

use crate::proxy;
use crate::settings::Settings;
use crate::state::{self, AppState, StatePayload};
use crate::tray;

fn app_state(app: &AppHandle) -> Arc<AppState> {
    app.state::<Arc<AppState>>().inner().clone()
}

pub fn launch_at_login(app: &AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

pub fn payload(app: &AppHandle) -> StatePayload {
    app_state(app).payload(launch_at_login(app))
}

pub fn refresh(app: &AppHandle) {
    app_state(app).refresh.notify_one();
}

pub fn open_dashboard(app: &AppHandle) -> Result<(), String> {
    let url = {
        let state = app_state(app);
        let inner = state.lock();
        proxy::base_url(&inner.settings.host, inner.settings.port).map_err(|e| e.to_string())?
    };
    app.opener().open_url(format!("{url}/dashboard"), None::<&str>).map_err(|e| e.to_string())
}

pub fn copy_summary(app: &AppHandle) -> Result<(), String> {
    let text = state::summary_text(&app_state(app).lock());
    app.clipboard().write_text(text).map_err(|e| e.to_string())
}

pub fn open_logs(app: &AppHandle) -> Result<(), String> {
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

/// Validates, persists and applies new settings. Nothing changes unless all of it is valid.
pub fn update_settings(app: &AppHandle, settings: Settings, launch_at_login: bool) -> Result<StatePayload, String> {
    settings.validate()?;
    let state = app_state(app);
    settings.save(&state.settings_path).map_err(|e| format!("Could not save settings: {e}"))?;

    if launch_at_login != self::launch_at_login(app) {
        let autolaunch = app.autolaunch();
        let result = if launch_at_login { autolaunch.enable() } else { autolaunch.disable() };
        result.map_err(|e| format!("Could not change Launch at Login: {e}"))?;
    }

    {
        let mut inner = state.lock();
        let endpoint_changed = inner.settings.host != settings.host || inner.settings.port != settings.port;
        inner.settings = settings;
        if endpoint_changed {
            inner.snapshot = None;
            inner.status = state::Status::Connecting;
            inner.error = None;
        }
        tray::update(app, &inner);
    }
    state.refresh.notify_one();
    log::info!("settings updated");
    Ok(payload(app))
}
