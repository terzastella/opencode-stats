import type { Lang } from "./i18n";

export function fmtInt(n: number, lang: Lang = "it"): string {
  return Math.round(n).toLocaleString(lang === "en" ? "en-US" : "it-IT");
}

/** 262500000 -> "262.5M", 17500 -> "17.5K", 1.5e12 -> "1.5T" */
export function fmtCompact(n: number): string {
  if (!isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000_000) return trim((n / 1_000_000_000_000).toFixed(2)) + "T";
  if (abs >= 1_000_000_000) return trim((n / 1_000_000_000).toFixed(2)) + "B";
  if (abs >= 1_000_000) return trim((n / 1_000_000).toFixed(1)) + "M";
  if (abs >= 1_000) return trim((n / 1_000).toFixed(1)) + "K";
  return String(Math.round(n));
}

function trim(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

export function fmtCost(n: number): string {
  if (!isFinite(n)) return "$0";
  if (Math.abs(n) < 1) return "$" + n.toFixed(4);
  if (Math.abs(n) < 100) return "$" + n.toFixed(2);
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function fmtBytes(n: number): string {
  if (n >= 1_073_741_824) return (n / 1_073_741_824).toFixed(2) + " GB";
  if (n >= 1_048_576) return (n / 1_048_576).toFixed(1) + " MB";
  if (n >= 1024) return (n / 1024).toFixed(1) + " KB";
  return n + " B";
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
