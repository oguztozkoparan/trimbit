import "./styles.css";

import markOnDark from "../branding/svg/mark-dark-bg.svg";
import markOnLight from "../branding/svg/mark-light-bg.svg";
import wordOnDark from "../branding/svg/wordmark-dark-bg.svg";
import wordOnLight from "../branding/svg/wordmark-light-bg.svg";
import offlineGlyph from "../branding/svg/tray-light-offline.svg";

import { api, type AppState, errorMessage, events, type Settings, type Snapshot, type TitleMode } from "./api";
import { append, h, icon, type IconName } from "./dom";
import * as fmt from "./format";

type View = "main" | "settings";

const root = document.getElementById("app") as HTMLElement;
let state: AppState | null = null;
let view: View = "main";
let toastTimer: number | undefined;

// ---- shared pieces -------------------------------------------------------------

function brand(): HTMLElement {
  return h(
    "div",
    { class: "brand" },
    themedImg(markOnDark, markOnLight, "", "brand-mark"),
    themedImg(wordOnDark, wordOnLight, "Trimbit", "brand-word"),
  );
}

/** Picks the dark- or light-surface asset via CSS; both are same-origin files. */
function themedImg(onDark: string, onLight: string, alt: string, cls: string): HTMLElement {
  return h(
    "span",
    { class: `themed ${cls}` },
    h("img", { class: "on-dark", attrs: { src: onDark, alt, draggable: "false" } }),
    h("img", { class: "on-light", attrs: { src: onLight, alt: "", "aria-hidden": "true", draggable: "false" } }),
  );
}

function iconButton(name: IconName, label: string, onClick: () => void): HTMLButtonElement {
  return h("button", { class: "icon-btn", title: label, attrs: { "aria-label": label, type: "button" }, onClick }, icon(name));
}

function button(label: string, onClick: () => void, opts: { icon?: IconName; kind?: string } = {}): HTMLButtonElement {
  return h(
    "button",
    { class: `btn ${opts.kind ?? ""}`.trim(), attrs: { type: "button" }, onClick },
    opts.icon ? icon(opts.icon, 15) : null,
    h("span", { text: label }),
  );
}

function statusPill(s: AppState): HTMLElement {
  const labels: Record<AppState["status"], string> = {
    connecting: "Connecting",
    online: "Online",
    degraded: "Degraded",
    offline: "Offline",
  };
  const version = s.status !== "offline" && s.snapshot?.version ? ` · v${s.snapshot.version}` : "";
  const uptime = s.snapshot?.uptimeSeconds;
  const title =
    s.status === "offline"
      ? (s.error ?? "Proxy unreachable")
      : `Proxy at ${s.baseUrl}${uptime != null ? ` · up ${fmt.duration(uptime)}` : ""}`;
  return h(
    "span",
    { class: `pill pill-${s.status}`, title, attrs: { role: "status" } },
    h("span", { class: "dot" }),
    `${labels[s.status]}${version}`,
  );
}

function toast(message: string, kind: "ok" | "error" = "ok"): void {
  document.querySelector(".toast")?.remove();
  const el = h("div", { class: `toast toast-${kind}`, attrs: { role: "alert" } }, icon(kind === "ok" ? "check" : "alert", 14), message);
  document.body.appendChild(el);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.remove(), 2600);
}

async function run(action: () => Promise<unknown>, success?: string): Promise<void> {
  try {
    await action();
    if (success) toast(success);
  } catch (err) {
    toast(errorMessage(err), "error");
  }
}

// ---- main view -----------------------------------------------------------------

function header(s: AppState): HTMLElement {
  return h(
    "header",
    { class: "bar" },
    brand(),
    h(
      "div",
      { class: "bar-actions" },
      statusPill(s),
      iconButton("refresh", "Refresh now (⌘R)", () => {
        root.querySelector(".icon-btn .icon")?.classList.add("spin");
        void run(api.refresh);
      }),
      iconButton("settings", "Settings (⌘,)", () => navigate("settings")),
    ),
  );
}

function stat(label: string, value: string, sub?: string, title?: string): HTMLElement {
  return h(
    "div",
    { class: "stat", ...(title ? { title } : {}) },
    h("span", { class: "stat-label", text: label }),
    h("span", { class: "stat-value num", text: value }),
    sub ? h("span", { class: "stat-sub", text: sub }) : null,
  );
}

function splitBar(parts: { label: string; value: number; display: string; cls: string }[]): HTMLElement {
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  return h(
    "div",
    { class: "split" },
    h(
      "div",
      { class: "split-track", attrs: { role: "img", "aria-label": parts.map((p) => `${p.label} ${p.display}`).join(", ") } },
      ...parts.map((p) => h("span", { class: `split-seg ${p.cls}`, style: { width: `${fmt.share(p.value, total)}%` } })),
    ),
    h(
      "div",
      { class: "split-legend" },
      ...parts.map((p) =>
        h("span", { class: "legend" }, h("span", { class: `swatch ${p.cls}` }), p.label, h("b", { class: "num", text: p.display })),
      ),
    ),
  );
}

function hero(snap: Snapshot): HTMLElement {
  const s = snap.session;
  const started = snap.sessionStarted ? `since ${fmt.clock(snap.sessionStarted)} · ${fmt.ago(snap.sessionStarted)}` : "";
  return h(
    "section",
    { class: "card hero" },
    h("div", { class: "eyebrow" }, "This session", h("span", { class: "muted", text: started })),
    h("div", { class: "hero-value num", text: fmt.usd(s.totalUsd) }),
    h(
      "div",
      { class: "hero-sub" },
      h("b", { class: "accent num", text: `${fmt.compact(s.tokensSaved)} tokens` }),
      ` saved · ${fmt.percent(s.savingsPercent)} of input · ${fmt.grouped(s.requests)} requests`,
    ),
    s.totalUsd > 0
      ? splitBar([
          { label: "Cache", value: s.cacheUsd, display: fmt.usd(s.cacheUsd), cls: "seg-a" },
          { label: "Compression", value: s.compressionUsd, display: fmt.usd(s.compressionUsd), cls: "seg-b" },
        ])
      : null,
  );
}

function grid(snap: Snapshot): HTMLElement {
  const cachedPct = fmt.share(snap.requestsCached, snap.requestsTotal);
  const failures = snap.requestsFailed + snap.requestsRateLimited;
  return h(
    "section",
    { class: "grid" },
    stat("Lifetime saved", fmt.usd(snap.lifetime.totalUsd), `${fmt.compact(snap.lifetime.tokensSaved)} tokens · ${fmt.grouped(snap.lifetime.requests)} req`),
    stat("All layers", fmt.compact(snap.allLayersSaved), `${fmt.percent(snap.allLayersPercent)} of tokens`),
    stat(
      "Requests",
      fmt.grouped(snap.requestsTotal),
      failures ? `${fmt.percent(cachedPct, 0)} cached · ${failures} failed` : `${fmt.percent(cachedPct, 0)} cached`,
    ),
    stat("Avg latency", fmt.millis(snap.avgLatencyMs), snap.mode ? `mode: ${snap.mode}` : undefined),
  );
}

function layers(snap: Snapshot): HTMLElement | null {
  if (snap.compressionSaved + snap.toolSearchSaved <= 0) return null;
  return h(
    "section",
    { class: "card" },
    h("div", { class: "eyebrow" }, "Where tokens were saved", h("span", { class: "muted", text: "since proxy restart" })),
    splitBar([
      { label: "Tool schemas", value: snap.toolSearchSaved, display: fmt.compact(snap.toolSearchSaved), cls: "seg-a" },
      { label: "Compression", value: snap.compressionSaved, display: fmt.compact(snap.compressionSaved), cls: "seg-b" },
    ]),
  );
}

function models(snap: Snapshot): HTMLElement | null {
  const top = snap.models.slice(0, 3);
  if (!top.length) return null;
  const max = Math.max(...top.map((m) => m.requests));
  return h(
    "section",
    { class: "card" },
    h("div", { class: "eyebrow" }, "Models", h("span", { class: "muted", text: "requests since restart" })),
    h(
      "ul",
      { class: "models" },
      ...top.map((m) =>
        h(
          "li",
          {},
          h("span", { class: "model-name", text: m.name, title: m.name }),
          h("span", { class: "model-bar" }, h("span", { style: { width: `${fmt.share(m.requests, max)}%` } })),
          h("span", { class: "num model-count", text: fmt.grouped(m.requests) }),
        ),
      ),
    ),
  );
}

function tip(snap: Snapshot): HTMLElement | null {
  if (!snap.tip) return null;
  return h("aside", { class: "tip" }, icon("bolt", 14), h("span", { text: snap.tip }));
}

function footer(s: AppState): HTMLElement {
  const checked = s.lastChecked ? `Updated ${fmt.clock(s.lastChecked, true)}` : "Not updated yet";
  return h(
    "footer",
    { class: "foot" },
    // Without data there is nothing to copy and no dashboard to open.
    s.snapshot &&
    h(
      "div",
      { class: "foot-actions" },
      button("Open Dashboard", () => void run(api.openDashboard), { icon: "external", kind: "primary" }),
      button("Copy Summary", () => void run(api.copySummary, "Summary copied"), { icon: "copy" }),
    ),
    h("div", { class: `foot-meta${s.snapshot ? "" : " flush"}` }, h("span", { text: checked }), h("span", { text: "Unofficial companion for Headroom" })),
  );
}

function offline(s: AppState): HTMLElement {
  return h(
    "section",
    { class: "empty" },
    h("img", { class: "empty-glyph", attrs: { src: offlineGlyph, alt: "", draggable: "false" } }),
    h("h2", { text: "Can't reach Headroom" }),
    h("p", { text: `Trimbit couldn't connect to the proxy at ${s.baseUrl || `port ${s.settings.port}`}.` }),
    h("p", { class: "muted" }, "Start it with ", h("code", { text: "headroom proxy" }), " or check the port in Settings."),
    h(
      "div",
      { class: "empty-actions" },
      button("Try Again", () => void run(api.refresh), { icon: "refresh", kind: "primary" }),
      button("Settings", () => navigate("settings"), { icon: "settings" }),
    ),
    s.error ? h("details", {}, h("summary", { text: "Details" }), h("code", { class: "error", text: s.error })) : null,
  );
}

function connecting(): HTMLElement {
  return h(
    "div",
    { class: "skeleton", attrs: { "aria-busy": "true", "aria-label": "Connecting to Headroom" } },
    h("div", { class: "sk sk-hero" }),
    h("div", { class: "grid" }, ...[0, 1, 2, 3].map(() => h("div", { class: "sk sk-stat" }))),
    h("div", { class: "sk sk-card" }),
  );
}

function renderMain(s: AppState): void {
  const content = h("main", { class: "content" });
  const snap = s.snapshot;

  if (s.status === "connecting" && !snap) {
    content.appendChild(connecting());
  } else if (!snap) {
    content.appendChild(offline(s));
  } else {
    if (s.status === "offline") {
      content.appendChild(
        h(
          "div",
          { class: "banner banner-offline", attrs: { role: "status" } },
          icon("alert", 14),
          h("span", { text: `Proxy unreachable. Showing data from ${fmt.clock(s.lastSuccess)}.` }),
          h("button", { class: "link", text: "Retry", attrs: { type: "button" }, onClick: () => void run(api.refresh) }),
        ),
      );
    } else if (s.status === "degraded") {
      content.appendChild(
        h("div", { class: "banner banner-degraded", attrs: { role: "status" } }, icon("alert", 14), h("span", { text: "Proxy reports degraded health." })),
      );
    }
    append(content, [hero(snap), grid(snap), layers(snap), models(snap), tip(snap)]);
    if (s.status === "offline") content.classList.add("stale");
  }

  const scroll = root.querySelector(".content")?.scrollTop ?? 0;
  root.replaceChildren(h("div", { class: "panel" }, header(s), content, footer(s)));
  content.scrollTop = scroll;
}

// ---- settings view ---------------------------------------------------------------

const TITLE_MODES: [TitleMode, string][] = [
  ["session_tokens", "Session tokens saved"],
  ["session_usd", "Session money saved"],
  ["lifetime_tokens", "Lifetime tokens saved"],
  ["lifetime_usd", "Lifetime money saved"],
  ["icon_only", "Icon only"],
];
const REFRESH_CHOICES = [5, 10, 30, 60];

async function save(patch: Partial<Settings>, launchAtLogin?: boolean): Promise<boolean> {
  if (!state) return false;
  try {
    state = await api.updateSettings({ ...state.settings, ...patch }, launchAtLogin ?? state.launchAtLogin);
    return true;
  } catch (err) {
    toast(errorMessage(err), "error");
    renderSettings(state); // revert controls to the persisted values
    return false;
  }
}

function row(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h(
    "div",
    { class: "row" },
    h("div", { class: "row-text" }, h("span", { class: "row-label", text: label }), hint ? h("span", { class: "row-hint", text: hint }) : null),
    control,
  );
}

function toggle(label: string, checked: boolean, onChange: (value: boolean) => void): HTMLElement {
  const input = h("input", { attrs: { type: "checkbox", role: "switch", "aria-label": label } });
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  return h("label", { class: "switch" }, input, h("span", { class: "switch-track" }));
}

function renderSettings(s: AppState): void {
  const select = h("select", { class: "select", attrs: { "aria-label": "Menu bar shows" } });
  for (const [value, label] of TITLE_MODES) {
    const opt = h("option", { text: label, attrs: { value } });
    opt.selected = value === s.settings.titleMode;
    select.appendChild(opt);
  }
  select.addEventListener("change", () => void save({ titleMode: select.value as TitleMode }));

  const segmented = h(
    "div",
    { class: "segmented", attrs: { role: "radiogroup", "aria-label": "Refresh interval" } },
    ...REFRESH_CHOICES.map((sec) => {
      const b = h("button", {
        text: `${sec}s`,
        class: sec === s.settings.refreshSeconds ? "active" : "",
        attrs: { type: "button", role: "radio", "aria-checked": String(sec === s.settings.refreshSeconds) },
        onClick: async () => {
          if (await save({ refreshSeconds: sec })) renderSettings(state as AppState);
        },
      });
      return b;
    }),
  );

  const port = h("input", {
    class: "input num",
    attrs: { type: "text", inputmode: "numeric", maxlength: "5", "aria-label": "Proxy port", spellcheck: "false", value: String(s.settings.port) },
  });
  const commitPort = async () => {
    const raw = port.value.trim();
    const n = Number(raw);
    if (!/^\d{1,5}$/.test(raw) || n < 1 || n > 65535) {
      port.classList.add("invalid");
      toast("Port must be a number between 1 and 65535.", "error");
      return;
    }
    port.classList.remove("invalid");
    if (state && n !== state.settings.port && (await save({ port: n }))) toast(`Watching port ${n}`);
  };
  port.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void commitPort();
  });
  port.addEventListener("blur", () => void commitPort());

  const windowsNote = s.platform === "windows" ? "Windows tray icons can't show text; hover the icon for a summary." : undefined;

  const content = h(
    "main",
    { class: "content settings" },
    h("h3", { class: "group-title", text: "Display" }),
    h(
      "div",
      { class: "group" },
      row(s.platform === "macos" ? "Menu bar shows" : "Tray shows", select, windowsNote),
      row("Refresh every", segmented),
    ),
    h("h3", { class: "group-title", text: "Proxy" }),
    h("div", { class: "group" }, row("Port", port, `Headroom proxy on ${s.settings.host}`)),
    h("h3", { class: "group-title", text: "System" }),
    h(
      "div",
      { class: "group" },
      row("Notify when proxy goes down or up", toggle("Notifications", s.settings.notifyStatusChanges, (v) => void save({ notifyStatusChanges: v }))),
      row("Launch at login", toggle("Launch at login", s.launchAtLogin, (v) => void save({}, v))),
      row("Logs", button("Open Folder", () => void run(api.openLogs), { icon: "folder", kind: "small" })),
    ),
    h(
      "div",
      { class: "about" },
      brand(),
      h("p", { text: `Version ${s.appVersion}` }),
      h("p", { class: "muted", text: "An unofficial menu bar companion for Headroom. Not affiliated with or endorsed by the Headroom project." }),
    ),
  );

  root.replaceChildren(
    h(
      "div",
      { class: "panel" },
      h(
        "header",
        { class: "bar" },
        h("div", { class: "bar-title" }, iconButton("back", "Back", () => navigate("main")), h("h1", { text: "Settings" })),
      ),
      content,
      h("footer", { class: "foot" }, h("div", { class: "foot-actions" }, button("Quit Trimbit", () => void api.quit(), { icon: "power", kind: "danger" }))),
    ),
  );
}

// ---- wiring ------------------------------------------------------------------------

function render(): void {
  if (!state) return;
  // Platform and native material drive corner radii, control shapes and surface tints in CSS.
  document.documentElement.dataset.platform = state.platform;
  document.documentElement.dataset.material = state.material;
  if (view === "settings") renderSettings(state);
  else renderMain(state);
}

function navigate(next: View): void {
  view = next;
  render();
}

function onKey(e: KeyboardEvent): void {
  const mod = e.metaKey || e.ctrlKey;
  if (e.key === "Escape") {
    if (view === "settings") navigate("main");
    else void api.hidePanel();
  } else if (mod && e.key.toLowerCase() === "r") {
    e.preventDefault();
    void run(api.refresh);
  } else if (mod && e.key === ",") {
    e.preventDefault();
    navigate("settings");
  } else if (mod && e.key.toLowerCase() === "q") {
    e.preventDefault();
    void api.quit();
  }
}

async function main(): Promise<void> {
  document.addEventListener("keydown", onKey);
  document.addEventListener("contextmenu", (e) => e.preventDefault());

  await events.onState((next) => {
    state = next;
    // Settings are form state; don't rebuild them under the user's cursor.
    if (view === "main") render();
  });
  await events.onNavigate((next) => navigate(next === "settings" ? "settings" : "main"));
  await events.onShown(() => {
    if (view === "main") render();
  });

  try {
    state = await api.getState();
    render();
  } catch (err) {
    root.replaceChildren(h("div", { class: "panel" }, h("p", { class: "fatal", text: `Trimbit could not load: ${errorMessage(err)}` })));
  }

  // Keep relative times ("18m ago") fresh between polls.
  window.setInterval(() => {
    if (view === "main" && !document.hidden) render();
  }, 30_000);
}

void main();
