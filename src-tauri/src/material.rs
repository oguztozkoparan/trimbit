//! Native panel backgrounds: Liquid Glass on macOS 26+, vibrancy on older macOS,
//! Acrylic on Windows, and an opaque surface on Linux.

use std::sync::OnceLock;

use tauri::WebviewWindow;

pub const CORNER_RADIUS: f64 = 16.0;

static CURRENT: OnceLock<&'static str> = OnceLock::new();

/// The material in use, so the UI can pick matching tints: `glass`, `vibrancy`, `acrylic` or `solid`.
pub fn current() -> &'static str {
    CURRENT.get().copied().unwrap_or("solid")
}

pub fn apply(window: &WebviewWindow) {
    let material = platform::apply(window);
    log::info!("panel material: {material}");
    let _ = CURRENT.set(material);
}

#[cfg(target_os = "macos")]
mod platform {
    use objc2::runtime::AnyClass;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSAutoresizingMaskOptions, NSGlassEffectView, NSWindow, NSWindowOrderingMode};
    use tauri::window::{Effect, EffectState, EffectsBuilder};
    use tauri::WebviewWindow;

    use super::CORNER_RADIUS;

    pub fn apply(window: &WebviewWindow) -> &'static str {
        if AnyClass::get(c"NSGlassEffectView").is_some() && liquid_glass(window).is_some() {
            return "glass";
        }
        let effects =
            EffectsBuilder::new().effect(Effect::Popover).state(EffectState::Active).radius(CORNER_RADIUS).build();
        match window.set_effects(effects) {
            Ok(()) => "vibrancy",
            Err(e) => {
                log::warn!("could not apply vibrancy: {e}");
                "solid"
            }
        }
    }

    /// Puts an `NSGlassEffectView` behind the webview (macOS 26+ only; the caller checks the class exists).
    #[allow(unsafe_code)]
    fn liquid_glass(window: &WebviewWindow) -> Option<()> {
        let mtm = MainThreadMarker::new()?;
        let ptr = window.ns_window().ok()?;
        // SAFETY: `ns_window()` returns the live NSWindow backing `window`, which outlives this call,
        // and we only touch it on the main thread (checked above).
        let ns_window = unsafe { ptr.cast::<NSWindow>().as_ref() }?;
        let content = ns_window.contentView()?;
        let glass = NSGlassEffectView::initWithFrame(mtm.alloc(), content.bounds());
        glass.setCornerRadius(CORNER_RADIUS);
        glass.setAutoresizingMask(
            NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable,
        );
        content.addSubview_positioned_relativeTo(&glass, NSWindowOrderingMode::Below, None);
        Some(())
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use tauri::window::{Effect, EffectsBuilder};
    use tauri::WebviewWindow;

    /// Fluent uses Acrylic for transient surfaces such as flyouts. Tauri doesn't report
    /// unsupported effects, so the UI keeps a tint that stays legible without it.
    pub fn apply(window: &WebviewWindow) -> &'static str {
        match window.set_effects(EffectsBuilder::new().effect(Effect::Acrylic).build()) {
            Ok(()) => "acrylic",
            Err(e) => {
                log::warn!("could not apply acrylic: {e}");
                "solid"
            }
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    use tauri::WebviewWindow;

    /// There is no portable blur API on Linux, and transparent GTK windows turn black
    /// without a compositor, so the panel stays opaque.
    pub fn apply(_window: &WebviewWindow) -> &'static str {
        "solid"
    }
}
