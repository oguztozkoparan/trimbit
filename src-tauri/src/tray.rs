//! System tray icon, its context menu and the panel window's show/hide logic.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Theme, WebviewWindow, Wry};

use crate::actions;
use crate::format;
use crate::material;
use crate::settings::TitleMode;
use crate::state::{AppState, Inner, Status};
use crate::updates::{self, UpdateStatus};

fn app_state(app: &AppHandle) -> std::sync::Arc<AppState> {
    app.state::<std::sync::Arc<AppState>>().inner().clone()
}

pub const TRAY_ID: &str = "trimbit";
pub const PANEL: &str = "panel";

/// Clicking the tray while the panel is open first blurs (and hides) the panel,
/// then delivers the click. Ignore the click if the panel was hidden just now.
const REOPEN_GRACE: Duration = Duration::from_millis(300);

/// Space between the tray icon and the panel, and between the panel and screen edges (logical px).
const PANEL_GAP: f64 = 6.0;

/// Tray icon bounds in physical screen pixels (x, y, width, height), from the latest tray event.
/// Linux never reports it, so the panel falls back to a screen corner there.
static TRAY_RECT: Mutex<Option<(f64, f64, f64, f64)>> = Mutex::new(None);

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
    // Only popped up by hand on macOS; elsewhere the tray owns it.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    menu: Menu<Wry>,
    summary: MenuItem<Wry>,
    update: MenuItem<Wry>,
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let summary = MenuItem::with_id(app, "summary", "Connecting to Headroom…", false, None::<&str>)?;
    let update = MenuItem::with_id(app, "update", "Check for Updates…", true, None::<&str>)?;
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
            &update,
            &MenuItem::with_id(app, "settings", "Settings…", true, Some("CmdOrCtrl+,"))?,
            &MenuItem::with_id(app, "quit", "Quit Trimbit", true, Some("CmdOrCtrl+Q"))?,
        ],
    )?;

    let icon = Image::from_bytes(icon_bytes(Status::Connecting, system_theme(app)))?;
    let builder = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("Trimbit — connecting…");
    // macOS: a menu attached to the status item opens on any click that misses tray-icon's click
    // catcher (e.g. on the title text), so it stays detached and right-click pops it up instead.
    let builder = if cfg!(target_os = "macos") { builder } else { builder.menu(&menu).show_menu_on_left_click(false) };
    builder
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_panel(app),
            "refresh" => actions::refresh(app),
            "dashboard" => log_err("open dashboard", actions::open_dashboard(app)),
            "copy" => log_err("copy summary", actions::copy_summary(app)),
            "settings" => {
                show_panel(app);
                log_err("navigate", app.emit_to(PANEL, "navigate", "settings").map_err(|e| e.to_string()));
            }
            "update" => {
                let app = app.clone();
                let available = matches!(app_state(&app).lock().update, UpdateStatus::Available { .. });
                tauri::async_runtime::spawn(async move {
                    if available {
                        updates::install(&app).await;
                    } else {
                        show_panel(&app);
                        let _ = app.emit_to(PANEL, "navigate", "settings");
                        updates::check(&app, true).await;
                    }
                });
            }
            "quit" => app.exit(0),
            _ => {}
        })
        // Left click toggles the panel; right click opens the menu (show_menu_on_left_click(false)).
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { rect, .. }
            | TrayIconEvent::Enter { rect, .. }
            | TrayIconEvent::Move { rect, .. } = &event
            {
                // tray-icon reports physical pixels, so a scale of 1.0 leaves them unchanged.
                let pos = rect.position.to_physical::<f64>(1.0);
                let size = rect.size.to_physical::<f64>(1.0);
                *TRAY_RECT.lock().unwrap_or_else(|p| p.into_inner()) = Some((pos.x, pos.y, size.width, size.height));
            }
            match event {
                TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } => {
                    toggle_panel(tray.app_handle());
                }
                #[cfg(target_os = "macos")]
                TrayIconEvent::Click { button: MouseButton::Right, button_state: MouseButtonState::Up, .. } => {
                    popup_menu(tray.app_handle());
                }
                _ => {}
            }
        })
        .build(app)?;

    app.manage(TrayMenu { menu, summary, update });
    Ok(())
}

/// Opens the tray menu at the pointer. The panel window only anchors the call: with no position,
/// the menu is placed in screen coordinates, so the panel doesn't need to be visible.
#[cfg(target_os = "macos")]
fn popup_menu(app: &AppHandle) {
    use tauri::menu::ContextMenu;

    let (Some(window), Some(menu)) = (panel(app), app.try_state::<TrayMenu>()) else { return };
    hide_panel(app);
    if let Err(e) = menu.menu.popup(window.as_ref().window()) {
        log::warn!("could not open tray menu: {e}");
    }
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
    let numbers = inner.settings.number_format;
    let title = snapshot.and_then(|s| match inner.settings.title_mode {
        TitleMode::SessionTokens => Some(format::tokens(s.session.tokens_saved, numbers)),
        TitleMode::SessionUsd => Some(format!("≈{}", format::usd(s.session.compression_usd))),
        TitleMode::LifetimeTokens => Some(format::tokens(s.lifetime.tokens_saved, numbers)),
        TitleMode::LifetimeUsd => Some(format!("≈{}", format::usd(s.lifetime.compression_usd))),
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
            "Session: {} tokens removed · ≈ {}",
            format::tokens(s.session.tokens_saved, numbers),
            format::usd(s.session.compression_usd)
        ),
        (_, None) => "Headroom proxy online".to_owned(),
    };
    tray.set_tooltip(Some(format!("Trimbit — {summary}")))?;
    if let Some(menu) = app.try_state::<TrayMenu>() {
        menu.summary.set_text(summary)?;
        let (label, enabled) = match &inner.update {
            UpdateStatus::Available { version } => (format!("Install Update {version}…"), true),
            UpdateStatus::Installing { version } => (format!("Installing {version}…"), false),
            UpdateStatus::Checking => ("Checking for Updates…".to_owned(), false),
            _ => ("Check for Updates…".to_owned(), true),
        };
        menu.update.set_text(label)?;
        menu.update.set_enabled(enabled)?;
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
    position_panel(app, &window);
    let _ = window.show();
    // macOS may constrain a window the first time it is ordered in; place it again once visible.
    position_panel(app, &window);
    let _ = window.set_focus();
    let _ = app.emit_to(PANEL, "panel-shown", ());
    actions::refresh(app);
}

/// Centres the panel under (or, for a bottom taskbar, above) the tray icon, on the monitor that
/// holds the icon, and keeps it inside that monitor's work area.
fn position_panel(app: &AppHandle, window: &WebviewWindow) {
    let Ok(size) = window.outer_size() else { return };
    let tray = *TRAY_RECT.lock().unwrap_or_else(|p| p.into_inner());
    let monitor = match tray {
        Some((x, y, w, h)) => app.monitor_from_point(x + w / 2.0, y + h / 2.0).ok().flatten(),
        None => None,
    }
    .or_else(|| app.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else { return };

    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let (ax, ay) = (f64::from(area.position.x), f64::from(area.position.y));
    let (aw, ah) = (f64::from(area.size.width), f64::from(area.size.height));
    let (w, h) = (f64::from(size.width), f64::from(size.height));
    // The glass sits inset in its window; offset so the visible panel keeps the gap.
    let inset = material::window_inset() * scale;
    let gap = PANEL_GAP * scale;

    let (x, y) = match tray {
        Some((tx, ty, tw, th)) => {
            let x = tx + tw / 2.0 - w / 2.0;
            let tray_at_bottom = ty + th / 2.0 > ay + ah / 2.0;
            let y = if tray_at_bottom { ty - h - gap + inset } else { ty + th + gap - inset };
            (x, y)
        }
        // No tray bounds (Linux): top-right, or bottom-right where the taskbar usually is.
        None if cfg!(target_os = "windows") => (ax + aw - w - gap + inset, ay + ah - h - gap + inset),
        None => (ax + aw - w - gap + inset, ay + gap - inset),
    };
    // `clamp` panics when min > max (a panel wider than the screen), so order the bounds first.
    let (min_x, min_y) = (ax + gap - inset, ay - inset);
    let x = x.clamp(min_x, (ax + aw - w - gap + inset).max(min_x));
    let y = y.clamp(min_y, (ay + ah - h + inset).max(min_y));

    if let Err(e) = window.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32)) {
        log::debug!("could not position panel: {e}");
    }
}

pub fn hide_panel(app: &AppHandle) {
    if let Some(window) = panel(app) {
        let _ = window.hide();
    }
    app.state::<std::sync::Arc<AppState>>().lock().panel_hidden_at = Some(Instant::now());
}
