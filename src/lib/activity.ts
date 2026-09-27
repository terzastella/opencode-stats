import { providerGroup, type DayStat } from "./types";

export type GroupPass = (group: string) => boolean;

/** YYYY-MM bucket key, or null for malformed days. */
export function monthKey(iso: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  return iso.slice(0, 7); // YYYY-MM
}

/** All-time bucketing: daily up to 90d, weekly up to ~18mo, monthly beyond. */
export type Granularity = "day" | "week" | "month";

export function granularityForSpan(spanDays: number): Granularity {
  if (spanDays <= 90) return "day";
  if (spanDays <= 540) return "week";
  return "month";
}

function toISO(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Last n calendar days (local midnight), oldest first. DST-safe. */
export function lastNDays(n: number): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    t.setDate(t.getDate() - i);
    out.push(toISO(t));
  }
  return out;
}

/** Sum input+output+reasoning tokens per day, filling missing days with 0. */
export function aggregateTokensByDay(
  rows: DayStat[],
  groupPass: GroupPass,
  days: string[],
): Map<string, number> {
  const map = new Map<string, number>(days.map((d) => [d, 0]));
  for (const r of rows) {
    if (!map.has(r.day)) continue;
    if (!groupPass(providerGroup(r.provider))) continue;
    const v =
      (Number.isFinite(r.input) ? r.input : 0) +
      (Number.isFinite(r.output) ? r.output : 0) +
      (Number.isFinite(r.reasoning) ? r.reasoning : 0);
    map.set(r.day, (map.get(r.day) ?? 0) + v);
  }
  return map;
}

export interface HeatCell {
  day: string;
  value: number;
  /** Monday=0 .. Sunday=6, or -1 for padding cells. */
  weekday: number;
  empty: boolean;
}

export interface HeatWeek {
  cells: (HeatCell | null)[];
  monthLabel: string | null;
}

/** Monday-first weekday index: Monday=0 .. Sunday=6. */
function mondayIndex(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return (dt.getDay() + 6) % 7;
}

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_IT = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];

/** Group a sorted day list into Monday-first week columns with padding. */
export function buildHeatmapWeeks(
  days: string[],
  totals: Map<string, number>,
  lang: "it" | "en" = "it",
): { weeks: HeatWeek[]; total: number; max: number } {
  const months = lang === "en" ? MONTHS_EN : MONTHS_IT;
  const weeks: HeatWeek[] = [];
  let total = 0;
  let max = 0;
  let current: (HeatCell | null)[] = [];
  let prevMonth = -1;

  const flush = () => {
    if (!current.length) return;
    while (current.length < 7) current.push(null);
    // Month label when the first real cell of the column starts a new month.
    let label: string | null = null;
    const first = current.find((c) => c !== null);
    if (first) {
      const mo = Number(first.day.slice(5, 7)) - 1;
      if (mo !== prevMonth) {
        label = months[mo] ?? null;
        prevMonth = mo;
      }
    }
    weeks.push({ cells: current, monthLabel: label });
    current = [];
  };

  for (const day of days) {
    const wd = mondayIndex(day);
    if (current.length === 0) {
      // Pad leading days so the column always starts on Monday.
      for (let p = 0; p < wd; p++) current.push(null);
    }
    const value = totals.get(day) ?? 0;
    total += value;
    if (value > max) max = value;
    current.push({ day, value, weekday: wd, empty: false });
    if (current.length === 7) flush();
  }
  flush();
  // GitHub-like: cap at last 53 columns.
  return { weeks: weeks.slice(-53), total, max };
}

/** 0 = empty, 1..4 intensity by quartiles over active days. */
export function levelFor(value: number, sortedActive: number[]): number {
  if (value <= 0 || !sortedActive.length) return 0;
  const q = (p: number) => sortedActive[Math.min(sortedActive.length - 1, Math.floor(p * sortedActive.length))];
  const q1 = q(0.25);
  const q2 = q(0.5);
  const q3 = q(0.75);
  if (value <= q1) return 1;
  if (value <= q2) return 2;
  if (value <= q3) return 3;
  return 4;
}

/** Sorted ascending positive values, used for quartile thresholds. */
export function sortedActiveValues(totals: Map<string, number>): number[] {
  return [...totals.values()].filter((v) => v > 0).sort((a, b) => a - b);
}
