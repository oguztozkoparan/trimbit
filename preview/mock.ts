// Dev-only UI preview: runs the panel in a normal browser with mocked IPC.
// Not part of the production bundle (vite builds index.html only).
//
//   npm run dev  →  http://127.0.0.1:1420/preview/?state=online|offline|stale|connecting&view=settings&theme=light

import { mockIPC } from "@tauri-apps/api/mocks";
import type { AppState, Snapshot } from "../src/api";

const params = new URLSearchParams(location.search);
const scenario = params.get("state") ?? "online";
const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

const snapshot: Snapshot = {
  session: { requests: 60, tokensSaved: 1_054_759, compressionUsd: 12.72, cacheUsd: 91.13, totalUsd: 103.85, inputCostUsd: 99.23, savingsPercent: 3.37 },
  lifetime: { requests: 178, tokensSaved: 2_352_186, compressionUsd: 32.22, cacheUsd: 245.38, totalUsd: 277.6, inputCostUsd: 301.96, savingsPercent: null },
  sessionStarted: iso(21 * 60_000),
  sessionLastActivity: iso(20_000),
  allLayersSaved: 10_647_961,
  allLayersPercent: 9.61,
  compressionSaved: 2_349_464,
  toolSearchSaved: 8_298_497,
  requestsTotal: 174,
  requestsCached: 155,
  requestsFailed: 0,
  requestsRateLimited: 0,
  avgLatencyMs: 15594.34,
  mode: "cache",
  primaryModel: "claude-fable-5-1",
  tip: "Most requests are prefix-frozen. Set HEADROOM_MODE=token to compress frozen messages and extend your session by ~25-35%.",
  version: "0.37.0",
  healthy: true,
  uptimeSeconds: 270_991,
  models: [
    { name: "claude-fable-5-1", requests: 72 },
    { name: "claude-sonnet-5", requests: 57 },
    { name: "claude-opus-5-5", requests: 45 },
  ],
};

const state: AppState = {
  status: scenario === "stale" ? "offline" : (scenario as AppState["status"]),
  error: scenario === "offline" || scenario === "stale" ? "proxy is not reachable: error sending request (connection refused)" : null,
  snapshot: scenario === "offline" || scenario === "connecting" ? null : snapshot,
  settings: { host: "127.0.0.1", port: 8787, refreshSeconds: 10, titleMode: "session_tokens", notifyStatusChanges: true },
  baseUrl: "http://127.0.0.1:8787",
  lastChecked: iso(4_000),
  lastSuccess: iso(scenario === "stale" ? 6 * 60_000 : 4_000),
  launchAtLogin: false,
  appVersion: "2.0.0",
  platform: params.get("platform") ?? "macos",
  material: (params.get("material") as AppState["material"] | null) ?? "solid",
};

let navigateHandler: number | undefined;

mockIPC((cmd, args) => {
  switch (cmd) {
    case "get_state":
      return state;
    case "update_settings": {
      const a = args as { settings: AppState["settings"]; launchAtLogin: boolean };
      Object.assign(state.settings, a.settings);
      state.launchAtLogin = a.launchAtLogin;
      return state;
    }
    case "plugin:event|listen":
      if ((args as { event: string }).event === "navigate") navigateHandler = (args as { handler: number }).handler;
      return 0;
    case "plugin:event|unlisten":
      return undefined;
    default:
      return undefined;
  }
});

await import("../src/main");

if (params.get("view") === "settings") {
  // Same path the backend uses: emit a `navigate` event to the registered listener.
  const cb = (window as unknown as Record<string, (e: unknown) => void>)[`_${navigateHandler}`];
  cb?.({ event: "navigate", id: 0, payload: "settings" });
  document.querySelector<HTMLButtonElement>('[aria-label^="Settings"]')?.click();
}

// ?theme=light|dark forces a scheme by promoting the matching media rules.
const forced = params.get("theme");
if (forced) {
  document.documentElement.style.colorScheme = forced;
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules)) {
      if (rule instanceof CSSMediaRule && rule.conditionText.includes(`prefers-color-scheme: ${forced}`)) {
        for (const inner of Array.from(rule.cssRules)) sheet.insertRule(inner.cssText, sheet.cssRules.length);
      }
    }
  }
}
