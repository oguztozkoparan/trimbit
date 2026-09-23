fn main() {
    // Declaring the app's commands lets capabilities allow-list them individually;
    // anything not listed here cannot be invoked from the webview.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
        "get_state",
        "refresh",
        "update_settings",
        "open_dashboard",
        "copy_summary",
        "open_logs",
        "hide_panel",
        "check_for_updates",
        "install_update",
        "copy_setup_command",
        "quit",
    ])))
    .unwrap_or_else(|err| {
        eprintln!("tauri build script failed: {err:#}");
        std::process::exit(1);
    });
}
