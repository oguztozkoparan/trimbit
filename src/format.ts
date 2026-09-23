// Display formatting. Mirrors src-tauri/src/format.rs for the shared cases.

const DASH = "–";
const UNITS: [number, string][] = [
  [1e3, "K"],
  [1e6, "M"],
  [1e9, "B"],
  [1e12, "T"],
];

const isNum = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n);

/** 1234 → "1.2K", 999_999 → "1M". */
export function compact(n: number | null | undefined): string {
  if (!isNum(n)) return DASH;
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(n);
  let idx = -1;
  for (let i = UNITS.length - 1; i >= 0; i--) {
    if (v >= UNITS[i]![0]) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return sign + Math.round(v).toString();
  let scaled = v / UNITS[idx]![0];
  if (scaled >= 999.95 && idx + 1 < UNITS.length) {
    idx += 1;
    scaled = v / UNITS[idx]![0];
  }
  const text = scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, "");
  return `${sign}${text}${UNITS[idx]![1]}`;
}

export function grouped(n: number | null | undefined): string {
  return isNum(n) ? Math.round(n).toLocaleString("en-US") : DASH;
}

export function usd(n: number | null | undefined): string {
  if (!isNum(n)) return DASH;
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(n);
  return v >= 1000 ? `${sign}$${grouped(v)}` : `${sign}$${v.toFixed(2)}`;
}

export function percent(n: number | null | undefined, digits = 1): string {
  return isNum(n) ? `${n.toFixed(digits)}%` : DASH;
}

/** 45 → "45s", 1085 → "18m", 11520 → "3h 12m", 270991 → "3d 3h". */
export function duration(seconds: number | null | undefined): string {
  if (!isNum(seconds) || seconds < 0) return DASH;
  let s = Math.floor(seconds);
  const days = Math.floor(s / 86400);
  s -= days * 86400;
  const hours = Math.floor(s / 3600);
  s -= hours * 3600;
  const minutes = Math.floor(s / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m`;
  return `${s}s`;
}

export function millis(ms: number | null | undefined): string {
  if (!isNum(ms)) return DASH;
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Local wall-clock time, e.g. "16:56". */
export function clock(iso: string | null | undefined, withSeconds = false): string {
  const d = parse(iso);
  if (!d) return DASH;
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
    hour12: false,
  });
}

/** "18m ago", "just now". */
export function ago(iso: string | null | undefined, now: Date = new Date()): string {
  const d = parse(iso);
  if (!d) return DASH;
  const seconds = (now.getTime() - d.getTime()) / 1000;
  if (seconds < 10) return "just now";
  return `${duration(seconds)} ago`;
}

/** Share of `part` in `total` as 0..100, safe for zero totals. */
export function share(part: number, total: number): number {
  if (!isNum(part) || !isNum(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, (part / total) * 100));
}
