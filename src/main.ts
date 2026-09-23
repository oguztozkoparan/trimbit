import "./styles.css";

import markOnDark from "../branding/svg/mark-dark-bg.svg";
import markOnLight from "../branding/svg/mark-light-bg.svg";
import wordOnDark from "../branding/svg/wordmark-dark-bg.svg";
import wordOnLight from "../branding/svg/wordmark-light-bg.svg";
import offlineGlyph from "../branding/svg/tray-light-offline.svg";

import { api, type AppState, errorMessage, events, type NumberFormat, type Settings, type Snapshot, type TitleMode } from "./api";
import { append, h, icon, type IconName } from "./dom";
import * as fmt from "./format";

type View = "main" | "settings" | "method";

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

function button(
  label: string,
  onClick: (el: HTMLButtonElement) => void,
  opts: { icon?: IconName; kind?: string } = {},
): HTMLButtonElement {
  const el: HTMLButtonElement = h(
    "button",
    { class: `btn ${opts.kind ?? ""}`.trim(), attrs: { type: "button" }, onClick: () => onClick(el) },
    opts.icon ? icon(opts.icon, 15) : null,
    h("span", { text: label }),
  );
  return el;
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
  // Before the first successful connection "Offline" reads like a fault; the welcome screen explains.
  const waiting = s.status === "offline" && !s.lastSuccess;
  return h(
    "span",
    { class: `pill pill-${waiting ? "connecting" : s.status}`, title, attrs: { role: "status" } },
    h("span", { class: "dot" }),
    waiting ? "Waiting for Headroom" : `${labels[s.status]}${version}`,
  );
}

function toast(message: string, kind: "ok" | "error" = "ok"): void {
  document.querySelector(".toast")?.remove();
  const el = h("div", { class: `toast toast-${kind}`, attrs: { role: "alert" } }, icon(kind === "ok" ? "check" : "alert", 14), message);
  document.body.appendChild(el);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.remove(), 2600);
}

async function run(action: () => Promise<unknown>, success?: string, busy?: HTMLButtonElement): Promise<void> {
  if (busy) {
    busy.disabled = true;
    busy.setAttribute("aria-busy", "true");
  }
  try {
    await action();
    if (success) toast(success);
  } catch (err) {
    toast(errorMessage(err), "error");
  } finally {
    busy?.removeAttribute("aria-busy");
    if (busy) busy.disabled = false;
  }
}

// ---- numbers ---------------------------------------------------------------------

const exactNumbers = (): boolean => state?.settings.numberFormat === "exact";

function tokens(n: number): string {
  return exactNumbers() ? fmt.grouped(n) : fmt.compact(n);
}

/** Exact value for tooltips when the short form is on screen. */
function exactTitle(n: number, unit = "tokens"): string | undefined {
  return exactNumbers() ? undefined : `${fmt.grouped(n)} ${unit}`;
}

function providerName(id: string | null): string {
  const names: Record<string, string> = { anthropic: "Anthropic", openai: "OpenAI", google: "Google", gemini: "Google" };
  if (!id) return "your provider";
  return names[id.toLowerCase()] ?? id.charAt(0).toUpperCase() + id.slice(1);
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
    { class: "stat", ...(title ? { title, attrs: { tabindex: "0" } } : {}) },
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

/** Dollar estimates are never exact; the "≈" keeps that visible wherever a price appears. */
const approx = (n: number): string => `≈ ${fmt.usd(n)}`;

function hero(snap: Snapshot): HTMLElement {
  const s = snap.session;
  const meta = [`${fmt.grouped(s.requests)} requests`, snap.sessionStarted ? `since ${fmt.clock(snap.sessionStarted)}` : ""]
    .filter(Boolean)
    .join(" · ");
  return h(
    "section",
    { class: "card hero" },
    h(
      "div",
      { class: "eyebrow" },
      "This session",
      h("span", { class: "muted", text: meta, ...(snap.sessionStarted ? { title: `Started ${fmt.ago(snap.sessionStarted)}` } : {}) }),
    ),
    // Headline: what Headroom itself removed, as a measured token count.
    h(
      "div",
      { class: "hero-row" },
      h(
        "div",
        {},
        h("div", {
          class: "hero-value num",
          text: tokens(s.tokensSaved),
          ...(exactTitle(s.tokensSaved) ? { title: exactTitle(s.tokensSaved) as string } : {}),
        }),
        h("div", { class: "hero-label", text: "tokens removed by Headroom" }),
        h("div", { class: "hero-label muted", text: `${fmt.percent(s.savingsPercent)} of input tokens` }),
      ),
      h(
        "button",
        {
          class: "info-btn",
          title: "How savings are calculated",
          attrs: { type: "button", "aria-label": "How savings are calculated" },
          onClick: () => navigate("method"),
        },
        icon("info", 14),
        h("span", { text: "How?" }),
      ),
    ),
    h(
      "div",
      { class: "ledger" },
      h(
        "div",
        { class: "ledger-row" },
        h("span", { class: "swatch seg-a" }),
        h(
          "span",
          { class: "ledger-text" },
          h("span", { class: "ledger-label", text: "Estimated value" }),
          h("span", { class: "ledger-sub", text: snap.litellmPricing === false ? "at a flat $3 / 1M tokens" : "at list input prices" }),
        ),
        h("b", { class: "num", text: approx(s.compressionUsd) }),
      ),
      s.cacheUsd > 0
        ? h(
            "div",
            {
              class: "ledger-row context",
              title: `${providerName(snap.cacheProvider)} bills cached prompt tokens at a discount. Most tools cache prompts on their own, so this isn't counted as Headroom's saving.`,
            },
            h("span", { class: "swatch seg-b" }),
            h(
              "span",
              { class: "ledger-text" },
              h("span", { class: "ledger-label", text: `${providerName(snap.cacheProvider)} cache discount` }),
              h("span", { class: "ledger-sub", text: `${tokens(s.cacheReadTokens)} tokens · not counted` }),
            ),
            h("b", { class: "num", text: approx(s.cacheUsd) }),
          )
        : null,
    ),
    snap.litellmPricing === false
      ? h(
          "button",
          { class: "estimate-note", attrs: { type: "button" }, onClick: () => navigate("method") },
          icon("alert", 13),
          h("span", { text: "Rough estimate · flat $3 / 1M token pricing" }),
        )
      : null,
  );
}

function grid(snap: Snapshot): HTMLElement {
  const cachedPct = fmt.share(snap.requestsCached, snap.requestsTotal);
  const failures = snap.requestsFailed + snap.requestsRateLimited;
  return h(
    "section",
    { class: "grid" },
    stat(
      "Lifetime · Headroom",
      approx(snap.lifetime.compressionUsd),
      exactNumbers()
        ? `${tokens(snap.lifetime.tokensSaved)} tokens`
        : `${tokens(snap.lifetime.tokensSaved)} tokens · ${fmt.grouped(snap.lifetime.requests)} req`,
      exactTitle(snap.lifetime.tokensSaved),
    ),
    stat("All layers", tokens(snap.allLayersSaved), `${fmt.percent(snap.allLayersPercent)} of tokens`, exactTitle(snap.allLayersSaved)),
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
      { label: "Tool schemas", value: snap.toolSearchSaved, display: tokens(snap.toolSearchSaved), cls: "seg-a" },
      { label: "Compression", value: snap.compressionSaved, display: tokens(snap.compressionSaved), cls: "seg-b" },
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
      button("Open Dashboard", (b) => void run(api.openDashboard, undefined, b), { icon: "external", kind: "primary" }),
      button("Copy Summary", (b) => void run(api.copySummary, "Summary copied", b), { icon: "copy" }),
    ),
    h("div", { class: `foot-meta${s.snapshot ? "" : " flush"}` }, h("span", { text: checked }), h("span", { text: "Unofficial companion for Headroom" })),
  );
}

/** A copyable setup command. The backend owns the text; the UI only names the step. */
function command(step: "install" | "run", text: string): HTMLElement {
  return h(
    "div",
    { class: "command" },
    h("code", { text }),
    h(
      "button",
      {
        class: "icon-btn",
        title: "Copy",
        attrs: { type: "button", "aria-label": `Copy ${text}` },
        onClick: () => void run(() => api.copySetupCommand(step), "Copied"),
      },
      icon("copy", 14),
    ),
  );
}

/** Shown until Trimbit has reached a proxy once: explains what it needs instead of an error. */
function welcome(s: AppState): HTMLElement {
  return h(
    "section",
    { class: "welcome" },
    h("div", { class: "welcome-mark" }, themedImg(markOnDark, markOnLight, "", "brand-mark")),
    h("h2", { text: "Welcome to Trimbit" }),
    h("p", { text: "Trimbit shows how many tokens the Headroom proxy saves you. Start Headroom and Trimbit connects on its own." }),
    h(
      "ol",
      { class: "setup" },
      h("li", {}, h("span", { class: "setup-title", text: "Install Headroom" }), command("install", 'pip install "headroom-ai[proxy]"')),
      h("li", {}, h("span", { class: "setup-title", text: "Start the proxy" }), command("run", "headroom proxy")),
      h(
        "li",
        {},
        h("span", { class: "setup-title", text: "Point your tools at it" }),
        h("span", { class: "setup-hint" }, "For Claude Code: ", h("code", { text: `ANTHROPIC_BASE_URL=${s.baseUrl || "http://127.0.0.1:8787"}` })),
      ),
    ),
    h(
      "div",
      { class: "empty-actions" },
      button("Check Again", (b) => void run(api.refresh, undefined, b), { icon: "refresh", kind: "primary" }),
      button("Settings", () => navigate("settings"), { icon: "settings" }),
    ),
    h("p", { class: "muted small", text: `Looking for Headroom on port ${s.settings.port}.` }),
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
    content.appendChild(s.lastSuccess ? offline(s) : welcome(s));
  } else {
    if (!snap.recognized) {
      content.appendChild(
        h(
          "div",
          { class: "banner banner-degraded", attrs: { role: "status" } },
          icon("alert", 14),
          h("span", { text: "This Headroom version reports stats Trimbit doesn't recognise, so some numbers may be missing. An update to Trimbit will likely fix it." }),
        ),
      );
    }
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

  const banner = updateBanner(s);
  if (banner) content.prepend(banner);

  const scroll = root.querySelector(".content")?.scrollTop ?? 0;
  root.replaceChildren(h("div", { class: "panel" }, header(s), content, footer(s)));
  content.scrollTop = scroll;
}

// ---- updates -----------------------------------------------------------------------

function updateBanner(s: AppState): HTMLElement | null {
  const u = s.update;
  if (u.state === "available") {
    return h(
      "div",
      { class: "banner banner-update", attrs: { role: "status" } },
      icon("download", 14),
      h("span", { text: `Trimbit ${u.version} is available.` }),
      h("button", { class: "link", text: "Install & Restart", attrs: { type: "button" }, onClick: () => void run(api.installUpdate) }),
    );
  }
  if (u.state === "installing") {
    return h(
      "div",
      { class: "banner banner-update", attrs: { role: "status", "aria-busy": "true" } },
      icon("download", 14),
      h("span", { text: `Installing Trimbit ${u.version}… it will restart when done.` }),
    );
  }
  return null;
}

function updateRow(s: AppState): HTMLElement {
  const u = s.update;
  const hint =
    u.state === "available"
      ? `Version ${u.version} is ready to install`
      : u.state === "installing"
        ? `Installing ${u.version}…`
        : u.state === "checking"
          ? "Checking…"
          : u.state === "upToDate"
            ? `You're on the latest version (${s.appVersion})`
            : u.state === "failed"
              ? u.message
              : `Version ${s.appVersion} · checks daily`;
  const action =
    u.state === "available"
      ? button("Install", (b) => void run(api.installUpdate, undefined, b), { icon: "download", kind: "small primary" })
      : button("Check Now", (b) => void run(api.checkForUpdates, undefined, b), { icon: "refresh", kind: "small" });
  if (u.state === "checking" || u.state === "installing") action.disabled = true;
  return row("Updates", action, hint);
}

// ---- savings method view ---------------------------------------------------------

const FALLBACK_RATE = 3; // USD per 1M input tokens, Headroom's price when LiteLLM is unavailable

function kv(label: string, value: string, title?: string): HTMLElement {
  return h("div", { class: "kv", ...(title ? { title } : {}) }, h("span", { text: label }), h("b", { class: "num", text: value }));
}

function methodCard(swatch: string, title: string, formula: string, body: (HTMLElement | string)[], rows: HTMLElement[]): HTMLElement {
  return h(
    "section",
    { class: "card method-card" },
    h("h2", { class: "method-title" }, h("span", { class: `swatch ${swatch}` }), title),
    h("code", { class: "formula", text: formula }),
    ...body.map((b) => (typeof b === "string" ? h("p", { text: b }) : b)),
    rows.length ? h("div", { class: "kv-list" }, ...rows) : null,
  );
}

function renderMethod(s: AppState): void {
  const snap = s.snapshot;
  const provider = providerName(snap?.cacheProvider ?? null);
  const discount = snap?.cacheReadDiscount ? ` (${snap.cacheReadDiscount} off)` : "";
  const hitRate = snap?.cacheHitRate != null ? ` ${fmt.percent(snap.cacheHitRate)} of input tokens were read from cache.` : "";
  // In fallback mode Headroom multiplies by one flat rate; show the formula it actually used.
  const flat = snap?.litellmPricing === false;
  const flatRate = `$${FALLBACK_RATE.toFixed(2)} / 1M`;

  const compression = methodCard(
    "seg-a",
    "Headroom compression",
    flat ? `removed tokens × ${flatRate} (flat rate)` : "removed tokens × model input price",
    ["Removed tokens are message content Headroom compressed plus tool schemas it kept out of the prompt until needed."],
    snap
      ? [kv("This session", fmt.usd(snap.session.compressionUsd)), kv("Lifetime", fmt.usd(snap.lifetime.compressionUsd))]
      : [],
  );

  const cache = methodCard(
    "seg-b",
    "Provider cache discount (not counted)",
    flat ? `cached tokens × ${flatRate} (flat rate)` : "cached tokens × (input price − cache-read price)",
    [
      `${provider} bills cached prompt tokens at a lower rate${discount}. Most tools, Claude Code included, cache prompts on their own, so this discount mostly happens with or without Headroom. Headroom may raise the hit rate, but it doesn't report by how much, so Trimbit shows this figure for context only.${hitRate}`,
    ],
    snap
      ? [
          kv("This session", `${tokens(snap.session.cacheReadTokens)} → ${fmt.usd(snap.session.cacheUsd)}`, exactTitle(snap.session.cacheReadTokens, "cached tokens")),
          kv("Lifetime", `${tokens(snap.lifetime.cacheReadTokens)} → ${fmt.usd(snap.lifetime.cacheUsd)}`, exactTitle(snap.lifetime.cacheReadTokens, "cached tokens")),
        ]
      : [],
  );

  let prices: HTMLElement;
  if (snap?.litellmPricing === false) {
    const example = snap.session.cacheReadTokens;
    prices = h(
      "section",
      { class: "card method-card warn" },
      h("h2", { class: "method-title" }, icon("alert", 14), "Prices are rough estimates"),
      h("p", {
        text: `Headroom can't load LiteLLM's model price list, so every model is priced at a flat ${flatRate} input tokens. Cached tokens are valued at that full rate instead of only the discount, so the cache figure is likely overstated.`,
      }),
      example > 0
        ? h("code", {
            class: "formula",
            text: `${fmt.grouped(example)} × ${flatRate} = ${fmt.usd((example * FALLBACK_RATE) / 1e6)}`,
          })
        : null,
      h("p", { class: "muted", text: "Installing Headroom with LiteLLM support switches it to per-model list prices." }),
    );
  } else {
    prices = h(
      "section",
      { class: "card method-card" },
      h("h2", { class: "method-title", text: "Prices" }),
      h("p", {
        text:
          snap?.litellmPricing === true
            ? "Per-model list prices from LiteLLM's pricing table, input tokens only."
            : "This Headroom version doesn't report where its prices come from.",
      }),
    );
  }

  const content = h(
    "main",
    { class: "content method" },
    h("p", {
      class: "method-intro",
      text: "Trimbit shows Headroom's own numbers. The headline is tokens Headroom removed, which is measured. Dollar values are estimates: token counts multiplied by list prices. Only compression is counted as Headroom's saving.",
    }),
    compression,
    cache,
    prices,
    h("p", {
      class: "footnote",
      text: "All amounts are USD estimates of input cost avoided, not your invoice. On a flat-rate subscription they are an equivalent value, not money back. Output tokens aren't included.",
    }),
  );

  root.replaceChildren(
    h(
      "div",
      { class: "panel" },
      h("header", { class: "bar" }, h("div", { class: "bar-title" }, iconButton("back", "Back", () => navigate("main")), h("h1", { text: "How savings are calculated" }))),
      content,
    ),
  );
}

// ---- settings view ---------------------------------------------------------------

const TITLE_MODES: [TitleMode, string][] = [
  ["session_tokens", "Session tokens"],
  ["session_usd", "Session value (est.)"],
  ["lifetime_tokens", "Lifetime tokens"],
  ["lifetime_usd", "Lifetime value (est.)"],
  ["icon_only", "Icon only"],
];
const REFRESH_CHOICES = [5, 10, 30, 60];
const NUMBER_FORMATS: (readonly [NumberFormat, string])[] = [
  ["compact", "1.2M"],
  ["exact", "1,234,567"],
];

function segmented<T extends string | number>(
  label: string,
  options: readonly (readonly [T, string])[],
  current: T,
  onPick: (value: T) => Promise<boolean>,
): HTMLElement {
  return h(
    "div",
    { class: "segmented", attrs: { role: "radiogroup", "aria-label": label } },
    ...options.map(([value, text]) =>
      h("button", {
        text,
        class: value === current ? "active" : "",
        attrs: { type: "button", role: "radio", "aria-checked": String(value === current) },
        onClick: async () => {
          if (await onPick(value)) renderSettings(state as AppState);
        },
      }),
    ),
  );
}

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

  const refresh = segmented(
    "Refresh interval",
    REFRESH_CHOICES.map((sec) => [sec, `${sec}s`] as const),
    s.settings.refreshSeconds,
    (refreshSeconds) => save({ refreshSeconds }),
  );
  const numbers = segmented(
    "Number format",
    NUMBER_FORMATS,
    s.settings.numberFormat,
    (numberFormat) => save({ numberFormat }),
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
      row("Numbers", numbers, exactNumbers() ? "Full token counts everywhere" : "Hover a short number for the exact count"),
      row("Refresh every", refresh),
    ),
    h("h3", { class: "group-title", text: "Proxy" }),
    h("div", { class: "group" }, row("Port", port, `Headroom proxy on ${s.settings.host}`)),
    h("h3", { class: "group-title", text: "System" }),
    h(
      "div",
      { class: "group" },
      row("Notify when proxy goes down or up", toggle("Notifications", s.settings.notifyStatusChanges, (v) => void save({ notifyStatusChanges: v }))),
      row("Launch at login", toggle("Launch at login", s.launchAtLogin, (v) => void save({}, v))),
      row("Check for updates automatically", toggle("Automatic update checks", s.settings.checkUpdates, (v) => void save({ checkUpdates: v }))),
      updateRow(s),
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
  else if (view === "method") renderMethod(state);
  else renderMain(state);
}

function navigate(next: View): void {
  view = next;
  render();
}

function onKey(e: KeyboardEvent): void {
  const mod = e.metaKey || e.ctrlKey;
  if (e.key === "Escape") {
    if (view !== "main") navigate("main");
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
    if (view !== "settings") render();
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
