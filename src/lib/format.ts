import type { Lang } from "./i18n";

function num(n: unknown): number {
  return typeof n === "number" && isFinite(n) ? n : 0;
}

export function fmtInt(n: unknown, lang: Lang = "it"): string {
  return Math.round(num(n)).toLocaleString(lang === "en" ? "en-US" : "it-IT");
}

/** 262500000 -> "262.5M", 17500 -> "17.5K", 1.5e12 -> "1.5T" */
export function fmtCompact(n: number): string {
  if (!isFinite(n)) return "0";
  const abs = Math.abs(n);
  const scaled: Array<[number, string, number]> = [
    [1_000_000_000_000, "T", 2],
    [1_000_000_000, "B", 2],
    [1_000_000, "M", 1],
    [1_000, "K", 1],
  ];
  for (const [unit, suffix, decimals] of scaled) {
    if (abs >= unit) {
      const v = trim((n / unit).toFixed(decimals));
      // 999.95K -> "1000K": carry into the next unit instead.
      if (v === "1000" || v === "-1000") return fmtCompact(n < 0 ? -unit * 1000 : unit * 1000);
      return v + suffix;
    }
  }
  return String(Math.round(n));
}

function trim(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

export function fmtCost(n: unknown, lang: Lang = "it"): string {
  const v = num(n);
  if (v === 0) return "$0";
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  const locale = lang === "en" ? "en-US" : "it-IT";
  if (abs < 1) return `${sign}$${abs.toFixed(4)}`;
  if (abs < 100) return `${sign}$${abs.toFixed(2)}`;
  return `${sign}$${abs.toLocaleString(locale, { maximumFractionDigits: 2 })}`;
}

/**
 * Axis-friendly dollars: "$1.2K" for large values, trimmed decimals
 * ("$0.05", "$1.5") for small ones so sub-dollar ticks never show "$0".
 */
export function fmtCostCompact(n: unknown): string {
  const v = num(n);
  if (v === 0) return "$0";
  if (Math.abs(v) >= 1000) return "$" + fmtCompact(v);
  return (v < 0 ? "-$" : "$") + trim(Math.abs(v).toFixed(4));
}

export function fmtBytes(n: unknown): string {
  const v = num(n);
  if (v >= 1_073_741_824) return (v / 1_073_741_824).toFixed(2) + " GB";
  if (v >= 1_048_576) return (v / 1_048_576).toFixed(1) + " MB";
  if (v >= 1024) return (v / 1024).toFixed(1) + " KB";
  return `${Math.round(v)} B`;
}

export function fmtDayIT(iso: string, lang: Lang = "it"): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dd = String(d).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return lang === "en" ? `${mm}/${dd}` : `${dd}/${mm}`;
}

export function timeHM(ms: number, lang: Lang = "it"): string {
  const d = new Date(ms);
  return d.toLocaleTimeString(lang === "en" ? "en-US" : "it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
