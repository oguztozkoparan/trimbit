"""Menu bar application."""

from __future__ import annotations

import logging
import threading
import webbrowser
from datetime import datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path

import rumps
from AppKit import (
    NSAttributedString,
    NSColor,
    NSFont,
    NSFontAttributeName,
    NSFontWeightMedium,
    NSForegroundColorAttributeName,
    NSImage,
    NSMutableAttributedString,
    NSMutableParagraphStyle,
    NSParagraphStyleAttributeName,
    NSPasteboard,
    NSPasteboardTypeString,
    NSTextAlignmentRight,
    NSTextTab,
)
from PyObjCTools import AppHelper

from trimbit_legacy import APP_NAME, __version__, login_item
from trimbit_legacy import formatting as fmt
from trimbit_legacy.config import REFRESH_INTERVALS, TITLE_MODES, Settings
from trimbit_legacy.stats import Snapshot, fetch

LOG_PATH = Path.home() / "Library" / "Logs" / APP_NAME / "trimbit-legacy.log"
ROW_WIDTH = 300.0
TIP_MAX_CHARS = 60
SYMBOL_ONLINE = "gauge.with.dots.needle.67percent"
SYMBOL_OFFLINE = "bolt.slash"

log = logging.getLogger("trimbit_legacy")


def _setup_logging() -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(LOG_PATH, maxBytes=512_000, backupCount=2)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logging.basicConfig(level=logging.INFO, handlers=[handler, logging.StreamHandler()])


def _menu_font_size() -> float:
    return NSFont.menuFontOfSize_(0).pointSize()


def _row_title(label: str, value: str) -> NSAttributedString:
    """'Label ............ value' with the value right-aligned in monospaced digits."""
    para = NSMutableParagraphStyle.alloc().init()
    para.setTabStops_([NSTextTab.alloc().initWithTextAlignment_location_options_(NSTextAlignmentRight, ROW_WIDTH, {})])
    size = _menu_font_size()
    title = NSMutableAttributedString.alloc().initWithString_attributes_(
        f"{label}\t",
        {
            NSFontAttributeName: NSFont.menuFontOfSize_(size),
            NSForegroundColorAttributeName: NSColor.secondaryLabelColor(),
            NSParagraphStyleAttributeName: para,
        },
    )
    title.appendAttributedString_(
        NSAttributedString.alloc().initWithString_attributes_(
            value,
            {
                NSFontAttributeName: NSFont.monospacedDigitSystemFontOfSize_weight_(size, NSFontWeightMedium),
                NSForegroundColorAttributeName: NSColor.labelColor(),
                NSParagraphStyleAttributeName: para,
            },
        )
    )
    return title


def _header_title(text: str) -> NSAttributedString:
    return NSAttributedString.alloc().initWithString_attributes_(
        text.upper(),
        {
            NSFontAttributeName: NSFont.boldSystemFontOfSize_(_menu_font_size() - 2),
            NSForegroundColorAttributeName: NSColor.tertiaryLabelColor(),
        },
    )


def _status_title(online: bool, detail: str) -> NSAttributedString:
    color = NSColor.systemGreenColor() if online else NSColor.systemRedColor()
    title = NSMutableAttributedString.alloc().initWithString_attributes_(
        "●  ", {NSForegroundColorAttributeName: color, NSFontAttributeName: NSFont.menuFontOfSize_(0)}
    )
    title.appendAttributedString_(
        NSAttributedString.alloc().initWithString_attributes_(
            detail,
            {
                NSFontAttributeName: NSFont.systemFontOfSize_weight_(_menu_font_size(), NSFontWeightMedium),
                NSForegroundColorAttributeName: NSColor.labelColor(),
            },
        )
    )
    return title


def _footer_title(text: str) -> NSAttributedString:
    return NSAttributedString.alloc().initWithString_attributes_(
        text,
        {
            NSFontAttributeName: NSFont.systemFontOfSize_(_menu_font_size() - 2),
            NSForegroundColorAttributeName: NSColor.tertiaryLabelColor(),
        },
    )


class Row:
    """A non-interactive label/value menu row."""

    def __init__(self, label: str):
        self.label = label
        self.item = rumps.MenuItem(label)
        self.set("–")

    def set(self, value: str) -> None:
        self.item._menuitem.setAttributedTitle_(_row_title(self.label, value))


class TrimbitLegacy(rumps.App):
    def __init__(self) -> None:
        super().__init__(APP_NAME, title=None, quit_button=None)
        self.settings = Settings.load()
        self.snapshot: Snapshot | None = None
        self.online: bool | None = None
        self.last_error: str | None = None
        self.last_updated: datetime | None = None
        self._inflight = False
        self._symbol: str | None = None

        self._build_menu()
        self._set_symbol(SYMBOL_OFFLINE)
        self._timer = rumps.Timer(self._tick, self.settings.refresh_seconds)
        self._timer.start()

    # ---- menu construction -------------------------------------------------

    def _build_menu(self) -> None:
        self.status_item = rumps.MenuItem("status")
        self.status_item._menuitem.setAttributedTitle_(_status_title(False, "Connecting…"))

        self.rows = {
            key: Row(label)
            for key, label in (
                ("s_tokens", "Tokens saved"),
                ("s_usd", "Money saved"),
                ("s_split", "Compression · Cache"),
                ("s_requests", "Requests"),
                ("s_started", "Started"),
                ("l_tokens", "Tokens saved"),
                ("l_usd", "Money saved"),
                ("l_requests", "Requests"),
                ("p_all", "Saved, all layers"),
                ("p_compression", "Compression"),
                ("p_tool", "Tool schema deferral"),
                ("p_requests", "Requests"),
                ("p_latency", "Avg latency"),
                ("p_model", "Top model"),
                ("p_mode", "Mode"),
            )
        }

        self.tip_item = rumps.MenuItem("tip")
        self.tip_item._menuitem.setHidden_(True)
        self.updated_item = rumps.MenuItem("updated")
        self.updated_item._menuitem.setAttributedTitle_(_footer_title("Not updated yet"))

        def header(text: str) -> rumps.MenuItem:
            item = rumps.MenuItem(text)
            item._menuitem.setAttributedTitle_(_header_title(text))
            return item

        r = self.rows
        self.menu = [
            self.status_item,
            None,
            header("This session"),
            *(r[k].item for k in ("s_tokens", "s_usd", "s_split", "s_requests", "s_started")),
            None,
            header("Lifetime"),
            *(r[k].item for k in ("l_tokens", "l_usd", "l_requests")),
            None,
            header("Proxy since restart"),
            *(r[k].item for k in ("p_all", "p_compression", "p_tool", "p_requests", "p_latency", "p_model", "p_mode")),
            self.tip_item,
            None,
            rumps.MenuItem("Open Dashboard", callback=self.open_dashboard, key="d"),
            rumps.MenuItem("Refresh Now", callback=self.refresh_now, key="r"),
            rumps.MenuItem("Copy Summary", callback=self.copy_summary, key="c"),
            self.updated_item,
            None,
            self._build_settings_menu(),
            rumps.MenuItem(f"About {APP_NAME}", callback=self.about),
            rumps.MenuItem(f"Quit {APP_NAME}", callback=rumps.quit_application, key="q"),
        ]

    def _build_settings_menu(self) -> rumps.MenuItem:
        settings_menu = rumps.MenuItem("Settings")

        self.mode_items: dict[str, rumps.MenuItem] = {}
        display = rumps.MenuItem("Menu Bar Shows")
        for mode, label in TITLE_MODES.items():
            item = rumps.MenuItem(label, callback=self._select_mode)
            item.mode = mode
            item.state = mode == self.settings.title_mode
            self.mode_items[mode] = item
            display.add(item)
        settings_menu.add(display)

        self.interval_items: dict[int, rumps.MenuItem] = {}
        interval = rumps.MenuItem("Refresh Every")
        for seconds in REFRESH_INTERVALS:
            item = rumps.MenuItem(f"{seconds} seconds", callback=self._select_interval)
            item.seconds = seconds
            item.state = seconds == self.settings.refresh_seconds
            self.interval_items[seconds] = item
            interval.add(item)
        settings_menu.add(interval)

        self.port_item = rumps.MenuItem(f"Proxy Port: {self.settings.port}…", callback=self.change_port)
        settings_menu.add(self.port_item)
        settings_menu.add(None)

        self.notify_item = rumps.MenuItem("Notify When Proxy Goes Up/Down", callback=self.toggle_notify)
        self.notify_item.state = self.settings.notify_status_changes
        settings_menu.add(self.notify_item)

        self.login_item = rumps.MenuItem(
            "Launch at Login", callback=self.toggle_login if login_item.is_supported() else None
        )
        self.login_item.state = login_item.is_enabled()
        settings_menu.add(self.login_item)

        settings_menu.add(None)
        settings_menu.add(rumps.MenuItem("Show Log File", callback=self.show_log))
        return settings_menu

    def _set_symbol(self, name: str) -> None:
        if name == self._symbol:
            return
        image = NSImage.imageWithSystemSymbolName_accessibilityDescription_(name, APP_NAME)
        if image is None:
            return
        image.setTemplate_(True)
        self._icon_nsimage = image
        self._symbol = name
        try:
            self._nsapp.setStatusBarIcon()
        except AttributeError:
            pass  # status bar not created yet; rumps picks up _icon_nsimage on launch

    # ---- polling -------------------------------------------------------------

    def _tick(self, _=None) -> None:
        if self._inflight:
            return
        self._inflight = True
        threading.Thread(target=self._worker, args=(self.settings.base_url,), daemon=True).start()

    def _worker(self, base_url: str) -> None:
        try:
            snapshot, error = fetch(base_url), None
        except Exception as exc:  # any failure must still reach _apply to clear _inflight
            snapshot, error = None, str(exc) or exc.__class__.__name__
        AppHelper.callAfter(self._apply, snapshot, error)

    def _apply(self, snapshot: Snapshot | None, error: str | None) -> None:
        self._inflight = False
        online = snapshot is not None
        if online != self.online:
            if online:
                log.info("proxy online at %s (version %s)", self.settings.base_url, snapshot.version)
            else:
                log.warning("proxy unreachable at %s: %s", self.settings.base_url, error)
            if self.online is not None:
                self._notify_status(online)
        self.online = online
        self.last_error = error
        self.last_updated = datetime.now()

        if snapshot is not None:
            self.snapshot = snapshot
            self._render_snapshot(snapshot)
        self._render_status()
        self._render_title()

    def _render_status(self) -> None:
        s = self.snapshot
        if self.online and s is not None:
            parts = ["Proxy online" if s.healthy else "Proxy degraded"]
            if s.version:
                parts.append(f"v{s.version}")
            if s.uptime_seconds is not None:
                parts.append(f"up {fmt.duration(s.uptime_seconds)}")
            self.status_item._menuitem.setAttributedTitle_(_status_title(s.healthy, " · ".join(parts)))
            self.status_item._menuitem.setToolTip_(self.settings.base_url)
        else:
            self.status_item._menuitem.setAttributedTitle_(
                _status_title(False, f"Proxy offline · port {self.settings.port}")
            )
            self.status_item._menuitem.setToolTip_(self.last_error)
        stamp = f"{self.last_updated:%H:%M:%S}" if self.last_updated else "never"
        suffix = "" if self.online else " (showing last known data)" if self.snapshot else ""
        self.updated_item._menuitem.setAttributedTitle_(_footer_title(f"Updated {stamp}{suffix}"))

    def _render_snapshot(self, s: Snapshot) -> None:
        r = self.rows
        r["s_tokens"].set(f"{fmt.compact(s.session.tokens_saved)}  ({fmt.percent(s.session.savings_percent)})")
        r["s_usd"].set(fmt.usd(s.session.total_usd))
        r["s_split"].set(f"{fmt.usd(s.session.compression_usd)} · {fmt.usd(s.session.cache_usd)}")
        r["s_requests"].set(fmt.grouped(s.session.requests))
        r["s_started"].set(fmt.since(s.session_started))

        r["l_tokens"].set(fmt.compact(s.lifetime.tokens_saved))
        r["l_usd"].set(fmt.usd(s.lifetime.total_usd))
        r["l_requests"].set(fmt.grouped(s.lifetime.requests))

        r["p_all"].set(f"{fmt.compact(s.all_layers_saved)}  ({fmt.percent(s.all_layers_percent)})")
        r["p_compression"].set(fmt.compact(s.compression_saved))
        r["p_tool"].set(fmt.compact(s.tool_search_saved))
        requests = f"{fmt.grouped(s.requests_total)} · {fmt.grouped(s.requests_cached)} cached"
        if s.requests_failed or s.requests_rate_limited:
            requests += f" · {s.requests_failed + s.requests_rate_limited} failed"
        r["p_requests"].set(requests)
        r["p_latency"].set(fmt.millis(s.avg_latency_ms))
        r["p_model"].set(s.primary_model or "–")
        r["p_mode"].set(s.mode or "–")

        tip = s.tip or ""
        self.tip_item._menuitem.setHidden_(not tip)
        if tip:
            short = tip if len(tip) <= TIP_MAX_CHARS else tip[: TIP_MAX_CHARS - 1].rstrip() + "…"
            self.tip_item._menuitem.setAttributedTitle_(_footer_title(f"💡 {short}"))
            self.tip_item._menuitem.setToolTip_(tip)

    def _render_title(self) -> None:
        s = self.snapshot
        mode = self.settings.title_mode
        self._set_symbol(SYMBOL_ONLINE if self.online else SYMBOL_OFFLINE)
        if mode == "icon_only" or not self.online or s is None:
            self.title = None
        elif mode == "session_tokens":
            self.title = fmt.compact(s.session.tokens_saved)
        elif mode == "session_usd":
            self.title = fmt.usd(s.session.total_usd)
        elif mode == "lifetime_tokens":
            self.title = fmt.compact(s.lifetime.tokens_saved)
        elif mode == "lifetime_usd":
            self.title = fmt.usd(s.lifetime.total_usd)

    def _notify_status(self, online: bool) -> None:
        # Notification Center requires a bundle identifier, so only notify from the packaged app.
        if not self.settings.notify_status_changes or not login_item.is_supported():
            return
        if online:
            rumps.notification(APP_NAME, "Headroom proxy is back online", self.settings.base_url, sound=False)
        else:
            rumps.notification(APP_NAME, "Headroom proxy is unreachable", self.last_error or "", sound=False)

    # ---- actions -------------------------------------------------------------

    def open_dashboard(self, _) -> None:
        webbrowser.open(f"{self.settings.base_url}/dashboard")

    def refresh_now(self, _) -> None:
        self._tick()

    def copy_summary(self, _) -> None:
        s = self.snapshot
        if s is None:
            text = f"Headroom proxy offline ({self.settings.base_url})"
        else:
            text = "\n".join(
                (
                    f"Headroom — session: {fmt.grouped(s.session.tokens_saved)} tokens saved "
                    f"({fmt.percent(s.session.savings_percent)}), {fmt.usd(s.session.total_usd)} saved, "
                    f"{fmt.grouped(s.session.requests)} requests",
                    f"Headroom — lifetime: {fmt.grouped(s.lifetime.tokens_saved)} tokens saved, "
                    f"{fmt.usd(s.lifetime.total_usd)} saved, {fmt.grouped(s.lifetime.requests)} requests",
                    f"Headroom — proxy all layers: {fmt.grouped(s.all_layers_saved)} tokens saved "
                    f"({fmt.percent(s.all_layers_percent)})",
                )
            )
        pasteboard = NSPasteboard.generalPasteboard()
        pasteboard.clearContents()
        pasteboard.setString_forType_(text, NSPasteboardTypeString)

    def _select_mode(self, sender) -> None:
        self.settings.title_mode = sender.mode
        for mode, item in self.mode_items.items():
            item.state = mode == sender.mode
        self.settings.save()
        self._render_title()

    def _select_interval(self, sender) -> None:
        self.settings.refresh_seconds = sender.seconds
        for seconds, item in self.interval_items.items():
            item.state = seconds == sender.seconds
        self.settings.save()
        self._timer.stop()
        self._timer.interval = sender.seconds
        self._timer.start()

    def change_port(self, _) -> None:
        response = rumps.Window(
            message="Port the Headroom proxy listens on (default 8787).",
            title="Proxy Port",
            default_text=str(self.settings.port),
            ok="Save",
            cancel="Cancel",
            dimensions=(160, 24),
        ).run()
        if not response.clicked:
            return
        text = response.text.strip()
        if not text.isdigit() or not 1 <= int(text) <= 65535:
            rumps.alert("Invalid port", f"“{text}” is not a port number between 1 and 65535.")
            return
        self.settings.port = int(text)
        self.settings.save()
        self.port_item.title = f"Proxy Port: {self.settings.port}…"
        self.snapshot = None
        self.online = None
        self._tick()

    def toggle_notify(self, sender) -> None:
        sender.state = not sender.state
        self.settings.notify_status_changes = bool(sender.state)
        self.settings.save()

    def toggle_login(self, sender) -> None:
        try:
            login_item.set_enabled(not sender.state)
        except (OSError, RuntimeError) as exc:
            rumps.alert("Launch at Login", str(exc))
            return
        sender.state = login_item.is_enabled()

    def show_log(self, _) -> None:
        webbrowser.open(LOG_PATH.as_uri())

    def about(self, _) -> None:
        version = self.snapshot.version if self.snapshot and self.snapshot.version else "unknown"
        rumps.alert(
            f"{APP_NAME} {__version__}",
            f"Menu bar monitor for the Headroom optimization proxy.\n\n"
            f"Proxy: {self.settings.base_url}\nProxy version: {version}\n"
            f"Settings: ~/Library/Application Support/{APP_NAME}/settings.json",
        )


def main() -> None:
    _setup_logging()
    log.info("%s %s starting", APP_NAME, __version__)
    TrimbitLegacy().run()
