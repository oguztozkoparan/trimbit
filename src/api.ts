// Typed wrappers around the backend's IPC surface. These are the only calls the
// panel can make; everything else is denied by capabilities/panel.json.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type Status = "connecting" | "online" | "degraded" | "offline";
export type TitleMode = "session_tokens" | "session_usd" | "lifetime_tokens" | "lifetime_usd" | "icon_only";
export type NumberFormat = "compact" | "exact";

export interface Savings {
  requests: number;
  tokensSaved: number;
  compressionUsd: number;
  cacheUsd: number;
  cacheReadTokens: number;
  totalUsd: number;
  inputCostUsd: number;
  savingsPercent: number | null;
}

export interface ModelCount {
  name: string;
  requests: number;
}

export interface Snapshot {
  session: Savings;
  lifetime: Savings;
  sessionStarted: string | null;
  sessionLastActivity: string | null;
  allLayersSaved: number;
  allLayersPercent: number | null;
  compressionSaved: number;
  toolSearchSaved: number;
  requestsTotal: number;
  requestsCached: number;
  requestsFailed: number;
  requestsRateLimited: number;
  avgLatencyMs: number | null;
  mode: string | null;
  primaryModel: string | null;
  tip: string | null;
  version: string | null;
  healthy: boolean;
  uptimeSeconds: number | null;
  models: ModelCount[];
  /** false: Headroom prices every model at a flat fallback rate. */
  litellmPricing: boolean | null;
  cacheProvider: string | null;
  cacheHitRate: number | null;
  cacheReadDiscount: string | null;
  /** false: a /stats format Trimbit doesn't recognise. */
  recognized: boolean;
}

export interface Settings {
  host: string;
  port: number;
  refreshSeconds: number;
  titleMode: TitleMode;
  numberFormat: NumberFormat;
  notifyStatusChanges: boolean;
  checkUpdates: boolean;
}

export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "upToDate" }
  | { state: "available"; version: string }
  | { state: "installing"; version: string }
  | { state: "failed"; message: string };

export interface AppState {
  status: Status;
  error: string | null;
  snapshot: Snapshot | null;
  settings: Settings;
  baseUrl: string;
  lastChecked: string | null;
  lastSuccess: string | null;
  launchAtLogin: boolean;
  appVersion: string;
  platform: string;
  material: "glass" | "vibrancy" | "acrylic" | "solid";
  update: UpdateStatus;
}

export const api = {
  getState: () => invoke<AppState>("get_state"),
  refresh: () => invoke<void>("refresh"),
  updateSettings: (settings: Settings, launchAtLogin: boolean) =>
    invoke<AppState>("update_settings", { settings, launchAtLogin }),
  openDashboard: () => invoke<void>("open_dashboard"),
  copySummary: () => invoke<void>("copy_summary"),
  openLogs: () => invoke<void>("open_logs"),
  hidePanel: () => invoke<void>("hide_panel"),
  checkForUpdates: () => invoke<void>("check_for_updates"),
  installUpdate: () => invoke<void>("install_update"),
  copySetupCommand: (step: "install" | "run") => invoke<void>("copy_setup_command", { step }),
  quit: () => invoke<void>("quit"),
};

export const events = {
  onState: (cb: (state: AppState) => void): Promise<UnlistenFn> => listen<AppState>("state", (e) => cb(e.payload)),
  onNavigate: (cb: (view: string) => void): Promise<UnlistenFn> => listen<string>("navigate", (e) => cb(e.payload)),
  onShown: (cb: () => void): Promise<UnlistenFn> => listen("panel-shown", () => cb()),
};

/** Tauri rejects with a plain string for our commands' `Err(String)`. */
export function errorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
