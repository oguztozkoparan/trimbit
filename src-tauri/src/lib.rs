//! Trimbit: an unofficial menu bar companion for the Headroom proxy.

mod actions;
mod format;
mod material;
mod proxy;
mod settings;
mod state;
mod tray;

use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};
use tauri_plugin_notification::NotificationExt as _;

use settings::Settings;
use state::{AppState, StatePayload, Status};

const MAX_LOG_BYTES: u128 = 1024 * 1024;

// ---- IPC commands (allow-listed in build.rs and capabilities/panel.json) ----

#[tauri::command]
fn get_state(app: AppHandle) -> StatePayload {
    actions::payload(&app)
}

#[tauri::command]
fn refresh(app: AppHandle) {
    actions::refresh(&app);
}

#[tauri::command]
fn update_settings(app: AppHandle, settings: Settings, launch_at_login: bool) -> Result<StatePayload, String> {
    actions::update_settings(&app, settings, launch_at_login)
}

#[tauri::command]
fn open_dashboard(app: AppHandle) -> Result<(), String> {
    actions::open_dashboard(&app)
}

#[tauri::command]
fn copy_summary(app: AppHandle) -> Result<(), String> {
    actions::copy_summary(&app)
}

#[tauri::command]
fn open_logs(app: AppHandle) -> Result<(), String> {
    actions::open_logs(&app)
}

#[tauri::command]
fn hide_panel(app: AppHandle) {
    tray::hide_panel(&app);
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

// ---- polling -------------------------------------------------------------------

async fn poll_loop(app: AppHandle, state: Arc<AppState>) {
    loop {
        let (host, port, interval) = {
            let inner = state.lock();
            (inner.settings.host.clone(), inner.settings.port, inner.settings.refresh_seconds)
        };
        let result = state.client.fetch(&host, port).await;
        apply_result(&app, &state, result);

        tokio::select! {
            () = tokio::time::sleep(Duration::from_secs(interval)) => {}
            () = state.refresh.notified() => {}
        }
    }
}

fn apply_result(app: &AppHandle, state: &AppState, result: Result<proxy::Snapshot, proxy::ProxyError>) {
    let now = chrono::Utc::now();
    let (previous, current, notify) = {
        let mut inner = state.lock();
        let previous = inner.status;
        inner.last_checked = Some(now);
        match result {
            Ok(snapshot) => {
                inner.status = if snapshot.healthy { Status::Online } else { Status::Degraded };
                inner.snapshot = Some(snapshot);
                inner.error = None;
                inner.last_success = Some(now);
            }
            Err(e) => {
                inner.status = Status::Offline;
                inner.error = Some(e.to_string());
            }
        }
        tray::update(app, &inner);
        (previous, inner.status, inner.settings.notify_status_changes)
    };

    if previous != current {
        let error = state.lock().error.clone().unwrap_or_default();
        match current {
            Status::Online => log::info!("proxy online"),
            Status::Degraded => log::warn!("proxy reports degraded health"),
            Status::Offline => log::warn!("proxy offline: {error}"),
            Status::Connecting => {}
        }
        // Only notify real transitions, not the first result after launch.
        if notify && previous != Status::Connecting && previous.is_up() != current.is_up() {
            let (title, body) = if current.is_up() {
                ("Headroom proxy is back online", "Trimbit is tracking savings again.".to_owned())
            } else {
                ("Headroom proxy is unreachable", error)
            };
            if let Err(e) = app.notification().builder().title(title).body(body).show() {
                log::warn!("could not show notification: {e}");
            }
        }
    }

    if let Err(e) = app.emit_to(tray::PANEL, "state", actions::payload(app)) {
        log::debug!("could not emit state: {e}");
    }
}

fn build_panel(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let builder = WebviewWindowBuilder::new(app, tray::PANEL, WebviewUrl::App("index.html".into()))
        .title("Trimbit")
        .inner_size(360.0, 580.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .shadow(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .visible(false)
        .focused(false);
    // Linux stays opaque; see material.rs.
    #[cfg(not(target_os = "linux"))]
    let builder = builder.transparent(true);
    builder.build()
}

// ---- entry point -----------------------------------------------------------------

pub fn run() {
    let result = tauri::Builder::default()
        // Must be registered first so a second launch focuses the first instance.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| tray::show_panel(app)))
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .max_file_size(MAX_LOG_BYTES)
                .rotation_strategy(RotationStrategy::KeepOne)
                .targets([Target::new(TargetKind::Stdout), Target::new(TargetKind::LogDir { file_name: None })])
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_positioner::init())
        .invoke_handler(tauri::generate_handler![
            get_state,
            refresh,
            update_settings,
            open_dashboard,
            copy_summary,
            open_logs,
            hide_panel,
            quit
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let settings_path = app.path().app_config_dir()?.join("settings.json");
            let settings = Settings::load(&settings_path);
            let client = proxy::Client::new()?;
            let state = Arc::new(AppState::new(settings, client, settings_path));
            app.manage(state.clone());

            let panel = build_panel(app.handle())?;
            material::apply(&panel);
            tray::build(app.handle())?;

            let handle = app.handle().clone();
            panel.on_window_event(move |event| {
                if let WindowEvent::Focused(false) = event {
                    tray::hide_panel(&handle);
                }
            });

            log::info!("Trimbit {} starting", env!("CARGO_PKG_VERSION"));
            tauri::async_runtime::spawn(poll_loop(app.handle().clone(), state));
            Ok(())
        })
        .run(tauri::generate_context!());

    if let Err(e) = result {
        log::error!("Trimbit failed to start: {e}");
        eprintln!("Trimbit failed to start: {e}");
        std::process::exit(1);
    }
}
