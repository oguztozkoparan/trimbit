//! System tray icon, its context menu and the panel window's show/hide logic.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Theme, WebviewWindow, Wry};
use tauri_plugin_positioner::{Position, WindowExt};

use crate::actions;
use crate::format;
use crate::settings::TitleMode;
use crate::state::{AppState, Inner, Status};

pub const TRAY_ID: &str = "trimbit";
pub const PANEL: &str = "panel";

/// Clicking the tray while the panel is open first blurs (and hides) the panel,
/// then delivers the click. Ignore the click if the panel was hidden just now.
const REOPEN_GRACE: Duration = Duration::from_millis(300);

static TRAY_POSITION_KNOWN: AtomicBool = AtomicBool::new(false);

macro_rules! icon {
    ($name:literal) => {
        include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../branding/png/", $name))
    };
}

fn icon_bytes(status: Status, theme: Theme) -> &'static [u8] {
    let up = status != Status::Offline;
    if cfg!(target_os = "macos") {
        return if up { icon!("tray-template@2x.png") } else { icon!("tray-template-offline@2x.png") };
    }
    // Windows follows the system theme; Linux panels are dark on nearly every desktop.
    let dark_panel = cfg!(target_os = "linux") || theme == Theme::Dark;
    match (dark_panel, up) {
        (true, true) => icon!("tray-light-32.png"),
        (true, false) => icon!("tray-light-offline-32.png"),
        (false, true) => icon!("tray-dark-32.png"),
        (false, false) => icon!("tray-dark-offline-32.png"),
    }
}

pub struct TrayMenu {
    summary: MenuItem<Wry>,
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let summary = MenuItem::with_id(app, "summary", "Connecting to Headroom…", false, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &summary,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "show", "Open Trimbit", true, None::<&str>)?,
            &MenuItem::with_id(app, "refresh", "Refresh Now", true, Some("CmdOrCtrl+R"))?,
            &MenuItem::with_id(app, "dashboard", "Open Headroom Dashboard", true, None::<&str>)?,
            &MenuItem::with_id(app, "copy", "Copy Summary", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "settings", "Settings…", true, Some("CmdOrCtrl+,"))?,
            &MenuItem::with_id(app, "quit", "Quit Trimbit", true, Some("CmdOrCtrl+Q"))?,
        ],
    )?;

    let icon = Image::from_bytes(icon_bytes(Status::Connecting, system_theme(app)))?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("Trimbit — connecting…")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_panel(app),
            "refresh" => actions::refresh(app),
            "dashboard" => log_err("open dashboard", actions::open_dashboard(app)),
            "copy" => log_err("copy summary", actions::copy_summary(app)),
            "settings" => {
                show_panel(app);
                log_err("navigate", app.emit_to(PANEL, "navigate", "settings").map_err(|e| e.to_string()));
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            let app = tray.app_handle();
            tauri_plugin_positioner::on_tray_event(app, &event);
            match event {
                TrayIconEvent::Click { .. } | TrayIconEvent::Enter { .. } | TrayIconEvent::Move { .. } => {
                    TRAY_POSITION_KNOWN.store(true, Ordering::Relaxed);
                }
                _ => {}
            }
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                toggle_panel(app);
            }
        })
        .build(app)?;

    app.manage(TrayMenu { summary });
    Ok(())
}

fn log_err(what: &str, result: Result<(), String>) {
    if let Err(e) = result {
        log::warn!("{what} failed: {e}");
    }
}

fn system_theme(app: &AppHandle) -> Theme {
    panel(app).and_then(|w| w.theme().ok()).unwrap_or(Theme::Dark)
}

fn panel(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(PANEL)
}

/// Refreshes icon, title, tooltip and menu summary from the current state.
pub fn update(app: &AppHandle, inner: &Inner) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    if let Err(e) = apply(app, &tray, inner) {
        log::warn!("could not update tray: {e}");
    }
}

fn apply(app: &AppHandle, tray: &TrayIcon, inner: &Inner) -> tauri::Result<()> {
    tray.set_icon(Some(Image::from_bytes(icon_bytes(inner.status, system_theme(app)))?))?;
    #[cfg(target_os = "macos")]
    tray.set_icon_as_template(true)?;

    let snapshot = inner.snapshot.as_ref().filter(|_| inner.status.is_up());
    let title = snapshot.and_then(|s| match inner.settings.title_mode {
        TitleMode::SessionTokens => Some(format::compact(s.session.tokens_saved)),
        TitleMode::SessionUsd => Some(format::usd(s.session.total_usd)),
        TitleMode::LifetimeTokens => Some(format::compact(s.lifetime.tokens_saved)),
        TitleMode::LifetimeUsd => Some(format::usd(s.lifetime.total_usd)),
        TitleMode::IconOnly => None,
    });
    // Windows has no tray titles; macOS and Linux (AppIndicator label) do.
    if !cfg!(target_os = "windows") {
        tray.set_title(title.as_deref())?;
    }

    let summary = match (inner.status, snapshot) {
        (Status::Connecting, _) => "Connecting to Headroom…".to_owned(),
        (Status::Offline, _) => format!("Headroom proxy offline · port {}", inner.settings.port),
        (_, Some(s)) => format!(
            "Session: {} tokens · {} saved",
            format::compact(s.session.tokens_saved),
            format::usd(s.session.total_usd)
        ),
        (_, None) => "Headroom proxy online".to_owned(),
    };
    tray.set_tooltip(Some(format!("Trimbit — {summary}")))?;
    if let Some(menu) = app.try_state::<TrayMenu>() {
        menu.summary.set_text(summary)?;
    }
    Ok(())
}

pub fn toggle_panel(app: &AppHandle) {
    let Some(window) = panel(app) else { return };
    if window.is_visible().unwrap_or(false) {
        hide_panel(app);
        return;
    }
    let recently_hidden =
        app.state::<std::sync::Arc<AppState>>().lock().panel_hidden_at.is_some_and(|t| t.elapsed() < REOPEN_GRACE);
    if !recently_hidden {
        show_panel(app);
    }
}

pub fn show_panel(app: &AppHandle) {
    let Some(window) = panel(app) else { return };
    let position = if TRAY_POSITION_KNOWN.load(Ordering::Relaxed) {
        if cfg!(target_os = "macos") {
            Position::TrayCenter
        } else {
            Position::TrayBottomCenter
        }
    } else if cfg!(target_os = "windows") {
        Position::BottomRight
    } else {
        Position::TopRight
    };
    if let Err(e) = window.as_ref().window().move_window(position) {
        log::debug!("could not position panel: {e}");
    }
    let _ = window.show();
    let _ = window.set_focus();
    let _ = app.emit_to(PANEL, "panel-shown", ());
    actions::refresh(app);
}

pub fn hide_panel(app: &AppHandle) {
    if let Some(window) = panel(app) {
        let _ = window.hide();
    }
    app.state::<std::sync::Arc<AppState>>().lock().panel_hidden_at = Some(Instant::now());
}
