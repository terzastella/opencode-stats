import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import { api, isTauriRuntime } from "./lib/api";
import { demoLang, demoSettings, demoView, isDemo } from "./lib/demo";
import { STRINGS, type Lang } from "./lib/i18n";
import { fmtBytes, fmtCompact, fmtCost, fmtCostCompact, fmtDayIT, fmtInt, timeHM } from "./lib/format";
import {
  DESC_MAX_LENGTH,
  loadProfile,
  saveProfile,
  type ProviderView,
  type RangeKey,
  type ViewMode,
} from "./lib/profile";
import { providerGroup, type Bucket, type DayStat, type DbInfo, type ModelStat, type Overview, type SelectionStats, type SessionRow } from "./lib/types";
import { providerColor } from "./lib/providers";
import { ProviderMark } from "./lib/brand";
import "./App.css";

echarts.use([LineChart, BarChart, PieChart, GridComponent, LegendComponent, TooltipComponent, SVGRenderer]);

const RANGE_DAYS: Record<RangeKey, number> = { daily: 14, weekly: 56, all: 365 };
const REFRESH_MS = 30_000;

function lastNDays(n: number): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    // setDate-based arithmetic: immune to DST midnight shifts.
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    t.setDate(t.getDate() - i);
    out.push(toISO(t));
  }
  return out;
}

function toISO(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function weekStartMonday(iso: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  const dow = (dt.getDay() + 6) % 7; // 0 = Monday
  const mon = new Date(dt.getTime() - dow * 86_400_000);
  return toISO(mon);
}

/** Neutral grayscale monogram from the profile name (e.g. "Il mio workspace" -> "IM"). */
function monogram(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "OS";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface Filters {
  groups: string[];
  selected: string[];
}

function useEChart(tag: string, option: echarts.EChartsCoreOption | null, onDiag: (msg: string | null) => void) {
  const chartRef = useRef<echarts.ECharts | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const optRef = useRef(option);
  optRef.current = option;
  const diagRef = useRef(onDiag);
  diagRef.current = onDiag;
  const tagRef = useRef(tag);
  tagRef.current = tag;

  const report = (msg: string | null) => {
    diagRef.current(msg);
  };

  const teardown = () => {
    roRef.current?.disconnect();
    roRef.current = null;
    chartRef.current?.dispose();
    chartRef.current = null;
  };

  // Callback ref: init runs exactly when the div attaches. A mount-only
  // effect would miss it because the dashboard mounts late (boot gate).
  const setRef = useCallback((el: HTMLDivElement | null) => {
    teardown();
    if (!el) return;
    try {
      // No theme name: every color is set explicitly in our options,
      // so no registered-theme lookup is involved at all.
      // SVG renderer: crisp output with zero GPU/canvas-compositing dependence.
      const chart = echarts.init(el, undefined, { renderer: "svg" });
      chartRef.current = chart;
      if (optRef.current) {
        chart.setOption(optRef.current, true);
        report(`${tagRef.current} ok ${chart.getWidth()}x${chart.getHeight()}`);
      } else {
        report(null);
      }
      if (import.meta.env.DEV) {
        console.log(`[chart:${tagRef.current}] init ${chart.getWidth()}x${chart.getHeight()}`);
      }
    } catch (e) {
      report(`${tagRef.current} init: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    // If the container had no size at attach (or changes later),
    // resize + repaint instead of staying blank forever.
    const ro = new ResizeObserver(() => {
      const c = chartRef.current;
      if (!c) return;
      try {
        c.resize();
        if (optRef.current) c.setOption(optRef.current, true);
        report(`${tagRef.current} ok ${c.getWidth()}x${c.getHeight()}`);
      } catch (e) {
        report(`${tagRef.current} paint: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
    ro.observe(el);
    roRef.current = ro;
  }, []);

  useEffect(() => {
    const onResize = () => chartRef.current?.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      teardown();
    };
  }, []);

  useEffect(() => {
    const c = chartRef.current;
    if (!c) {
      if (import.meta.env.DEV) console.log(`[chart:${tagRef.current}] skip apply: no instance`);
      return;
    }
    try {
      if (!optRef.current) {
        // No data: wipe stale slices instead of keeping ghosts.
        c.clear();
        return;
      }
      // Replace (not merge): filtered-out series must disappear, not linger.
      // Animations stay off, so replace is cheap and stutter-free.
      c.setOption(optRef.current, true);
      if (import.meta.env.DEV) {
        console.log(`[chart:${tagRef.current}] setOption ok ${c.getWidth()}x${c.getHeight()}`);
      }
      report(`${tagRef.current} ok ${c.getWidth()}x${c.getHeight()}`);
    } catch (e) {
      report(`${tagRef.current} paint: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [option]);

  return setRef;
}

export default function App() {
  const [profile, setProfile] = useState(() => {
    const p = loadProfile();
    if (isDemo()) {
      // Demo overrides (?view=pie|bars, ?lang=it|en) for screenshots and testing.
      const dv = demoView();
      if (dv) p.providerView = dv;
      const dl = demoLang();
      if (dl) {
        p.lang = dl;
        if (p.name === "Il mio workspace" || p.name === "My workspace") {
          p.name = dl === "en" ? "My workspace" : "Il mio workspace";
        }
      }
    }
    return p;
  });
  const lang = profile.lang;
  const S = STRINGS[lang];
  const RANGE_LABEL: Record<RangeKey, string> = {
    daily: S["tab.daily"],
    weekly: S["tab.weekly"],
    all: S["tab.all"],
  };
  const [editingName, setEditingName] = useState(false);
  const [dbInfo, setDbInfo] = useState<DbInfo | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [daily, setDaily] = useState<DayStat[]>([]);
  const [models, setModels] = useState<ModelStat[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedMs, setUpdatedMs] = useState(0);
  const [live, setLive] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [diagMs, setDiagMs] = useState<number | null>(null);
  const [chartDiag, setChartDiag] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(() => isDemo() && demoSettings());
  // Where a modal-backdrop press started (text-selection guard, see below).
  const backdropPressRef = useRef(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [booted, setBooted] = useState(false);
  const [inTauri] = useState(isTauriRuntime);

  const range = profile.range;
  const viewMode = profile.viewMode;
  const dark = profile.theme === "dark";

  useEffect(() => {
    document.documentElement.dataset.theme = profile.theme;
    document.documentElement.lang = profile.lang;
    saveProfile(profile);
  }, [profile]);

  const setRange = (r: RangeKey) => setProfile((p) => ({ ...p, range: r }));
  const setViewMode = (v: ViewMode) => setProfile((p) => ({ ...p, viewMode: v }));
  const setProviderView = (v: ProviderView) => setProfile((p) => ({ ...p, providerView: v }));
  const setLang = (v: Lang) => setProfile((p) => ({ ...p, lang: v }));

  // Crop editor state: full-res image kept in memory until confirmed.
  // Only the final 256px crop is persisted to the profile.
  interface CropState {
    url: string;
    iw: number;
    ih: number;
    scale: number;
    minScale: number;
    x: number;
    y: number;
  }
  const [crop, setCrop] = useState<CropState | null>(null);
  const cropImgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const STAGE = 220;

  const clampPan = (x: number, y: number, scale: number, iw: number, ih: number) => {
    const mx = Math.max(0, (iw * scale - STAGE) / 2);
    const my = Math.max(0, (ih * scale - STAGE) / 2);
    return {
      x: Math.min(mx, Math.max(-mx, x)),
      y: Math.min(my, Math.max(-my, y)),
    };
  };

  // Profile photo: file -> crop editor (pan + zoom), confirm saves 256px JPEG.
  const openCrop = (img: HTMLImageElement, url: string) => {
    cropImgRef.current = img;
    const minScale = Math.max(STAGE / img.width, STAGE / img.height);
    setCrop({ url, iw: img.width, ih: img.height, scale: minScale, minScale, x: 0, y: 0 });
  };

  const onPhotoFile = (f: File | undefined) => {
    setPhotoError(null);
    if (!f) return;
    if (!f.type.startsWith("image/") || f.size > 10 * 1024 * 1024) {
      setPhotoError(S["settings.photoError"]);
      return;
    }
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      if (img.width < 2 || img.height < 2) {
        URL.revokeObjectURL(url);
        setPhotoError(S["settings.photoError"]);
        return;
      }
      openCrop(img, url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setPhotoError(S["settings.photoError"]);
    };
    img.src = url;
  };

  // Demo hook (?demo=crop): synthetic test image straight into the editor.
  useEffect(() => {
    if (!isDemo()) return;
    try {
      if (new URLSearchParams(window.location.search).get("demo") !== "crop") return;
    } catch {
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 300;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const grad = ctx.createLinearGradient(0, 0, 400, 300);
    grad.addColorStop(0, "#5aa9ff");
    grad.addColorStop(1, "#7ee0b8");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 400, 300);
    ctx.fillStyle = "#101013";
    ctx.beginPath();
    ctx.arc(200, 150, 70, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fafafa";
    ctx.font = "bold 90px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("T", 200, 155);
    const img = new Image();
    img.onload = () => {
      cropImgRef.current = img;
      const minScale = Math.max(STAGE / img.width, STAGE / img.height);
      // NOTE: object URL not needed (canvas-backed); use the data URL directly.
      setCrop({ url: img.src, iw: img.width, ih: img.height, scale: minScale, minScale, x: 0, y: 0 });
      setSettingsOpen(true);
    };
    img.src = canvas.toDataURL("image/png");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeCrop = () => {
    if (crop?.url.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(crop.url);
      } catch {
        /* noop */
      }
    }
    cropImgRef.current = null;
    setCrop(null);
  };

  const confirmCrop = () => {
    const img = cropImgRef.current;
    if (!img || !crop) return;
    try {
      // Stage circle (diameter STAGE, centered) mapped back to source pixels.
      const half = STAGE / 2 / crop.scale;
      const cx = crop.iw / 2 - crop.x / crop.scale;
      const cy = crop.ih / 2 - crop.y / crop.scale;
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setPhotoError(S["settings.photoError"]);
        return;
      }
      ctx.drawImage(img, cx - half, cy - half, half * 2, half * 2, 0, 0, 256, 256);
      setProfile((p) => ({ ...p, photo: canvas.toDataURL("image/jpeg", 0.87) }));
      closeCrop();
    } catch {
      setPhotoError(S["settings.photoError"]);
    }
  };

  // Close settings with Escape.
  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSettingsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsOpen]);

  const refreshingRef = useRef(false);
  const loadedOnceRef = useRef(false);
  const sigRef = useRef("");

  const refresh = useCallback(async (opts?: { manual?: boolean; boot?: boolean }) => {
    // Skip overlapping ticks: a slow cycle must never pile up new ones.
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    const days = RANGE_DAYS[profile.range];
    // Spinner only on boot or manual refresh; background ticks stay silent.
    if (opts?.manual === true || opts?.boot === true || !loadedOnceRef.current) setLoading(true);
    const t0 = performance.now();
    try {
      // Cheap existence check FIRST: no database -> friendly setup screen,
      // without burning full scans every tick. Auto-recovers when OpenCode
      // appears later (the tick just runs the full flow again).
      const info = await api.dbInfo();
      setDbInfo(info);
      if (!info.exists) {
        setNeedsSetup(true);
        setLoading(false);
        setUpdatedMs(Date.now());
        return;
      }
      setNeedsSetup(false);
      const [dash, se] = await Promise.all([
        api.dashboard(days),
        api.sessionList(days, 100),
      ]);
      const sig = [
        info.exists, info.path, info.sessions, info.messages,
        dash.daily.length, dash.models.length, se.length,
        dash.overview.input, dash.overview.output,
        dash.overview.sessions, dash.overview.messages,
        dash.overview.cacheRead, dash.overview.cacheWrite,
        Math.round(dash.overview.cost * 10000),
      ].join(":");
      if (sig !== sigRef.current || !loadedOnceRef.current) {
        sigRef.current = sig;
        setOverview(dash.overview);
        setDaily(dash.daily);
        setModels(dash.models);
        setSessions(se);
        setError(null);
      }
      loadedOnceRef.current = true;
      setLoading(false);
      setDiagMs(Math.round(performance.now() - t0));
      setUpdatedMs(Date.now());
    } catch (e) {
      setError(
        inTauri
          ? `${S["err.readFailed"]}${e instanceof Error ? e.message : String(e)}`
          : S["err.noTauri"]
      );
      setLoading(false);
    } finally {
      refreshingRef.current = false;
    }
  }, [profile.range, inTauri, S]);

  // Boot: full-screen loader until everything is loaded, then the dashboard.
  // Safety timeout guarantees we never stay stuck on the loader.
  // Mounted guard: StrictMode double-mount in dev must not fire boot twice.
  const bootMountedRef = useRef(false);
  useEffect(() => {
    if (bootMountedRef.current) return;
    bootMountedRef.current = true;
    const safety = window.setTimeout(() => {
      setError((prev) => prev ?? S["err.slowStart"]);
      setBooted(true);
    }, 25000);
    void refresh({ boot: true }).finally(() => {
      window.clearTimeout(safety);
      setBooted(true);
    });
    return () => window.clearTimeout(safety);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => void refresh(), REFRESH_MS);
    const onFocus = () => void refresh();
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [live, refresh]);

  const filters: Filters = useMemo(() => {
    const set = new Map<string, number>();
    for (const m of models) {
      const g = providerGroup(m.provider);
      set.set(g, (set.get(g) ?? 0) + m.input);
    }
    const groups = [...set.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g);
    const valid = selected.filter((s) => set.has(s));
    return { groups, selected: valid };
  }, [models, selected]);

  // Prune selections that no longer exist (outside render).
  useEffect(() => {
    setSelected((s) => {
      const valid = s.filter((x) => filters.groups.includes(x));
      return valid.length === s.length ? s : valid;
    });
  }, [filters.groups]);

  const selEmpty = filters.selected.length === 0;
  const groupPass = (g: string) => selEmpty || filters.selected.includes(g);

  // Selection honesty data: fetched ONLY while a provider filter is active,
  // so the default path pays zero extra queries.
  const [selStats, setSelStats] = useState<SelectionStats | null>(null);
  const selStatsRef = useRef(false);
  useEffect(() => {
    if (selEmpty) {
      setSelStats(null);
      return;
    }
    if (selStatsRef.current) return;
    selStatsRef.current = true;
    const days = RANGE_DAYS[profile.range];
    api
      .selectionStats(days)
      .then((st) => setSelStats(st))
      .catch(() => setSelStats(null))
      .finally(() => {
        selStatsRef.current = false;
      });
  }, [selEmpty, filters.selected, profile.range]);

  /** session_id -> dominant provider (by input), only while filtered. */
  const sessionProviders = useMemo(() => {
    const map = new Map<string, string>();
    for (const sp of selStats?.session_providers ?? []) {
      if (sp.session_id) map.set(sp.session_id, sp.provider);
    }
    return map;
  }, [selStats]);

  /** Distinct sessions per selected (provider, model), from selection stats. */
  const selSessions = useMemo(() => {
    if (!selStats) return 0;
    let n = 0;
    for (const m of selStats.model_sessions) {
      const g = providerGroup(m.provider);
      if (filters.selected.includes(g)) n += m.sessions;
    }
    return n;
  }, [selStats, filters.selected]);

  const buckets: Bucket[] = useMemo(() => {
    const days = RANGE_DAYS[range];
    const map = new Map<string, Bucket>();
    const get = (k: string): Bucket => {
      let b = map.get(k);
      if (!b) {
        b = { key: k, label: fmtDayIT(k, lang), input: 0, output: 0, cost: 0, messages: 0 };
        map.set(k, b);
      }
      return b;
    };
    const bucketKey = (day: string): string | null => {
      if (range === "weekly" || range === "all") return weekStartMonday(day);
      return day;
    };
    const add = (r: DayStat) => {
      if (!groupPass(providerGroup(r.provider))) return;
      const key = bucketKey(r.day);
      if (!key) return;
      // Daily view: ignore rows outside the visible window (stale/odd days).
      if (range === "daily" && !map.has(key)) return;
      const b = get(key);
      b.input += r.input;
      b.output += r.output;
      b.cost += r.cost;
      b.messages += r.messages;
    };
    if (range === "weekly") {
      for (const r of daily) add(r);
      return [...map.keys()].sort().slice(-8).map((k) => map.get(k)!);
    }
    if (range === "all") {
      // Honest aggregation: one bucket per week over the whole range.
      for (const r of daily) add(r);
      return [...map.keys()].sort().slice(-60).map((k) => map.get(k)!);
    }
    for (const k of lastNDays(days)) get(k);
    for (const r of daily) add(r);
    return [...map.keys()].sort().map((k) => map.get(k)!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daily, range, lang, filters.selected]);

  /** Per-provider totals aligned with `buckets` (for "Singoli" line chart, max 6 groups). */
  const splitGroups = useMemo(() => {
    const groups = (filters.selected.length ? filters.selected : filters.groups).slice(0, 6);
    const idx = new Map(buckets.map((b, i) => [b.key, i]));
    const data = new Map<string, number[]>();
    for (const g of groups) data.set(g, buckets.map(() => 0));
    for (const r of daily) {
      const g = providerGroup(r.provider);
      const arr = data.get(g);
      if (!arr) continue;
      // Same bucketing as `buckets` (weekly keys for weekly/all ranges).
      const key = range === "daily" ? r.day : weekStartMonday(r.day);
      if (!key) continue;
      const i = idx.get(key);
      if (i === undefined) continue;
      arr[i] += r.input + r.output;
    }
    return groups.map((g) => ({ group: g, values: data.get(g)! }));
  }, [daily, range, buckets, filters.selected, filters.groups]);

  const providerShare = useMemo(() => {
    const map = new Map<string, { input: number; cost: number; messages: number }>();
    for (const m of models) {
      const g = providerGroup(m.provider);
      if (filters.selected.length && !filters.selected.includes(g)) continue;
      const e = map.get(g) ?? { input: 0, cost: 0, messages: 0 };
      e.input += m.input;
      e.cost += m.cost;
      e.messages += m.messages;
      map.set(g, e);
    }
    return [...map.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.input - a.input)
      .slice(0, 8);
  }, [models, filters.selected]);


  interface TableRow {
    key: string;
    model: string;
    group: string;
    messages: number;
    input: number;
    output: number;
    cost: number;
  }

  const tableRows: TableRow[] = useMemo(() => {
    const rows: TableRow[] = [];
    for (const m of models) {
      const g = providerGroup(m.provider);
      if (!groupPass(g)) continue;
      rows.push({
        key: `${m.provider}/${m.model}`,
        model: m.model,
        group: g,
        messages: m.messages,
        input: m.input,
        output: m.output,
        cost: m.cost,
      });
    }
    return rows.sort((a, b) => b.input - a.input).slice(0, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, filters.selected]);

  const totals = useMemo(() => {
    const base =
      overview ?? { sessions: 0, messages: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
    if (selEmpty) return base;
    let input = 0,
      output = 0,
      cost = 0,
      messages = 0,
      cacheRead = 0,
      cacheWrite = 0;
    for (const r of daily) {
      if (!filters.selected.includes(providerGroup(r.provider))) continue;
      input += r.input;
      output += r.output;
      cost += r.cost;
      messages += r.messages;
    }
    for (const m of models) {
      if (!filters.selected.includes(providerGroup(m.provider))) continue;
      cacheRead += m.cacheRead;
      cacheWrite += m.cacheWrite;
    }
    // Sessions come from selection stats (distinct per model); falls back to
    // the unfiltered count only while that fetch is still in flight.
    const sessions = selStats ? selSessions : base.sessions;
    return { ...base, input, output, cost, messages, cacheRead, cacheWrite, sessions };
  }, [overview, daily, models, selStats, selSessions, filters.selected, selEmpty]);

  const fg = dark ? "#fafafa" : "#18181b";
  const faint = dark ? "#71717a" : "#a1a1aa";
  const grid = dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)";
  const tipBg = dark ? "#17171b" : "#ffffff";
  const tipBorder = dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.12)";
  const primary = dark ? "#fafafa" : "#09090b";
  const secondary = dark ? "#8e8e96" : "#63636b";

  const themeName = dark ? "dark" : "light";

  const tokensOption: echarts.EChartsCoreOption | null = useMemo(() => {
    if (!buckets.length) return null;
    const baseTooltip = {
      trigger: "axis" as const,
      backgroundColor: tipBg,
      borderColor: tipBorder,
      textStyle: { color: fg, fontSize: 12 },
      valueFormatter: (value: number | string) => fmtCompact(Number(value)),
    };
    const baseAxis = {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: faint, fontSize: 10 },
    };
    if (viewMode === "split" && splitGroups.length) {
      return {
        animation: false,
        tooltip: baseTooltip,
        legend: {
          data: splitGroups.map((s) => s.group),
          textStyle: { color: faint, fontSize: 11 },
        },
        grid: { left: 52, right: 14, top: 34, bottom: 26 },
        xAxis: { type: "category", data: buckets.map((b) => b.label), ...baseAxis },
        yAxis: {
          type: "value",
          axisLabel: { color: faint, fontSize: 10, formatter: (v: number) => fmtCompact(v) },
          splitLine: { lineStyle: { color: grid } },
        },
        series: splitGroups.map((s) => ({
          name: s.group,
          type: "line",
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2, color: providerColor(s.group, themeName) },
          itemStyle: { color: providerColor(s.group, themeName) },
          data: s.values,
        })),
      };
    }
    return {
      animation: false,
      color: [primary, secondary],
      tooltip: {
        trigger: "axis",
        backgroundColor: tipBg,
        borderColor: tipBorder,
        textStyle: { color: fg, fontSize: 12 },
        valueFormatter: (value: number | string) => fmtCompact(Number(value)),
      },
      legend: { data: [S["series.input"], S["series.output"]], textStyle: { color: faint, fontSize: 11 } },
      grid: { left: 52, right: 14, top: 34, bottom: 26 },
      xAxis: {
        type: "category",
        data: buckets.map((b) => b.label),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: faint, fontSize: 10 },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: faint, fontSize: 10, formatter: (v: number) => fmtCompact(v) },
        splitLine: { lineStyle: { color: grid } },
      },
      series: [
        {
          name: S["series.input"],
          type: "line",
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2 },
          areaStyle: {
            opacity: 0.9,
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: dark ? "rgba(250,250,250,0.22)" : "rgba(9,9,11,0.16)" },
              { offset: 1, color: "rgba(0,0,0,0)" },
            ]),
          },
          data: buckets.map((b) => b.input),
        },
        {
          name: S["series.output"],
          type: "line",
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 1.5, type: "dashed" },
          areaStyle: {
            opacity: 0.9,
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: dark ? "rgba(142,142,150,0.20)" : "rgba(99,99,107,0.14)" },
              { offset: 1, color: "rgba(0,0,0,0)" },
            ]),
          },
          data: buckets.map((b) => b.output),
        },
      ],
    };
  }, [buckets, fg, faint, grid, tipBg, tipBorder, primary, secondary, dark, viewMode, splitGroups, themeName, S]);

  const costOption: echarts.EChartsCoreOption | null = useMemo(() => {
    if (!buckets.length) return null;
    return {
      animation: false,
      tooltip: {
        trigger: "axis",
        backgroundColor: tipBg,
        borderColor: tipBorder,
        textStyle: { color: fg, fontSize: 12 },
        valueFormatter: (value: number | string) => fmtCost(Number(value), lang),
      },
      grid: { left: 52, right: 14, top: 30, bottom: 26 },
      xAxis: {
        type: "category",
        data: buckets.map((b) => b.label),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: faint, fontSize: 10 },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: faint, fontSize: 10, formatter: (v: number) => fmtCostCompact(v) },
        splitLine: { lineStyle: { color: grid } },
      },
      series: [
        {
          name: S["series.cost"],
          type: "bar",
          data: buckets.map((b) => Number((Number.isFinite(b.cost) ? b.cost : 0).toFixed(4))),
          barMaxWidth: 22,
          itemStyle: { color: dark ? "#e4e4e7" : "#3f3f46", borderRadius: [3, 3, 0, 0] },
          emphasis: { itemStyle: { color: primary } },
        },
      ],
    };
  }, [buckets, fg, faint, grid, tipBg, tipBorder, primary, dark, S]);

  // Horizontal bars per provider: readable even when one provider
  // dominates (a donut would look like a single disc).
  const providerBarsOption: echarts.EChartsCoreOption | null = useMemo(() => {
    const rows = [...providerShare].reverse();
    if (!rows.length) return null;
    return {
      animation: false,
      tooltip: {
        trigger: "axis",
        backgroundColor: tipBg,
        borderColor: tipBorder,
        textStyle: { color: fg, fontSize: 12 },
        valueFormatter: (value: number | string) => fmtCompact(Number(value)),
      },
      grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
      xAxis: {
        type: "value",
        axisLabel: { color: faint, fontSize: 10, formatter: (v: number) => fmtCompact(v) },
        splitLine: { lineStyle: { color: grid } },
      },
      yAxis: {
        type: "category",
        data: rows.map((p) => p.name),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: fg, fontSize: 11 },
      },
      series: [
        {
          name: S["series.input"],
          type: "bar",
          data: rows.map((p) => ({
            value: p.input,
            itemStyle: { color: providerColor(p.name, themeName), borderRadius: [0, 4, 4, 0] },
          })),
          barMaxWidth: 18,
          label: {
            show: true,
            position: "right",
            color: faint,
            fontSize: 10,
            formatter: (p: { value: number | string }) => fmtCompact(Number(p.value)),
          },
        },
      ],
    };
  }, [providerShare, fg, faint, grid, tipBg, tipBorder, themeName, S]);

  // Donut alternative: best when shares are balanced.
  // Zero-value slices are dropped (they only cluttered legend and labels).
  const pieRows = useMemo(() => providerShare.filter((p) => p.input > 0), [providerShare]);
  const pieOption: echarts.EChartsCoreOption | null = useMemo(() => {
    if (!pieRows.length) return null;
    return {
      animation: false,
      color: pieRows.map((p) => providerColor(p.name, themeName)),
      tooltip: {
        trigger: "item",
        formatter: (p: { name: string; value: number | string; percent?: number }) =>
          `${p.name}: ${fmtCompact(Number(p.value))} (${Number(p.percent ?? 0).toFixed(1)}%)`,
        backgroundColor: tipBg,
        borderColor: tipBorder,
        textStyle: { color: fg, fontSize: 12 },
      },
      legend: { orient: "vertical", right: 8, top: "middle", textStyle: { color: faint, fontSize: 11 } },
      series: [
        {
          name: S["card.providers"],
          type: "pie",
          radius: ["44%", "68%"],
          center: ["38%", "50%"],
          label: {
            color: faint,
            fontSize: 11,
            formatter: (p: { name: string; value: number | string }) =>
              `${p.name}\n${fmtCompact(Number(p.value))}`,
          },
          labelLine: { lineStyle: { color: faint } },
          itemStyle: {
            borderColor: dark ? "#101013" : "#ffffff",
            borderWidth: 2,
            borderRadius: 3,
          },
          data: pieRows.map((p) => ({ name: p.name, value: p.input })),
        },
      ],
    };
  }, [pieRows, fg, faint, tipBg, tipBorder, dark, themeName, S]);

  // Chart errors stick in the footer diagnostics; routine "ok" noise is
  // swallowed so release builds stay clean (only real problems surface).
  const reportChart = (m: string | null) => {
    if (m == null || m.includes(" ok ")) return;
    setChartDiag(m);
  };
  const tokensRef = useEChart("tokens", tokensOption, reportChart);
  const costRef = useEChart("costo", costOption, reportChart);
  const providerChartRef = useEChart("provider", providerBarsOption, reportChart);
  const pieChartRef = useEChart("torta", pieOption, reportChart);

  const toggleGroup = (g: string) =>
    setSelected((s) => (s.includes(g) ? s.filter((x) => x !== g) : [...s, g]));

  // Boot loader: full-screen until everything is loaded, then the dashboard.
  if (!booted) {
    return (
      <div className="boot">
        <div className="boot-card">
          <div className="boot-logo">◧</div>
          <h1>OpenCode Stats</h1>
          <p className="boot-sub">{S["boot.loading"]}</p>
          <div className="boot-bar"><span /></div>
          <ul className="boot-steps">
            <li className="active">
              <span className="step-mark">…</span>
              {S["boot.db"]}
            </li>
          </ul>
        </div>
      </div>
    );
  }

  // Friendly empty state: OpenCode isn't installed (or has never run),
  // so there is no database to read. No technical banners, no empty charts.
  // Clears itself on the next tick once the database appears.
  if (booted && needsSetup) {
    return (
      <div className="boot">
        <div className="boot-card">
          <div className="boot-logo">◧</div>
          <h1>{S["setup.title"]}</h1>
          <p className="boot-sub">{S["setup.sub"]}</p>
          <p className="mono dim setup-hint">{S["setup.hint"]}</p>
          <button className="pill" onClick={() => void refresh({ manual: true })} disabled={loading}>
            {loading ? "…" : `↻ ${S["refresh"]}`}
          </button>
          <div className="seg mini" role="group" aria-label={S["lang.aria"]}>
            <button className={lang === "it" ? "seg-btn active" : "seg-btn"} onClick={() => setLang("it")}>
              IT
            </button>
            <button className={lang === "en" ? "seg-btn active" : "seg-btn"} onClick={() => setLang("en")}>
              EN
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <button className="avatar" onClick={() => { setPhotoError(null); setSettingsOpen(true); }} title={S["settings.title"]}>
            {profile.photo ? (
              <img src={profile.photo} alt="" className="avatar-img" />
            ) : (
              monogram(profile.name)
            )}
          </button>
          <div className="brand-text">
            {editingName ? (
              <input
                className="name-input"
                autoFocus
                value={profile.name}
                onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
                onBlur={() => setEditingName(false)}
                onKeyDown={(e) => e.key === "Enter" && setEditingName(false)}
                maxLength={48}
              />
            ) : (
              <button className="profile-name" onClick={() => setEditingName(true)} title={S["profile.editName"]}>
                {profile.name}
              </button>
            )}
            {profile.desc ? (
              <span className="profile-desc" title={profile.desc}>{profile.desc}</span>
            ) : null}
          </div>
        </div>

        <nav className="tabs" aria-label={S["range.aria"]}>
          {(Object.keys(RANGE_LABEL) as RangeKey[]).map((k) => (
            <button key={k} className={range === k ? "tab active" : "tab"} onClick={() => setRange(k)}>
              {RANGE_LABEL[k]}
            </button>
          ))}
        </nav>

        <div className="actions">
          <button
            className={live ? "pill live-on" : "pill"}
            onClick={() => setLive((v) => !v)}
            title={S["live.title"]}
          >
            <span className="dot" /> {live ? S["live.on"] : S["live.off"]}
          </button>
          <button className="pill" onClick={() => void refresh({ manual: true })} disabled={loading}>
            {loading ? "…" : `↻ ${S["refresh"]}`}
          </button>
          <button
            className="pill"
            onClick={() => setProfile((p) => ({ ...p, theme: p.theme === "dark" ? "light" : "dark" }))}
            title={S["theme.toggle"]}
          >
            {dark ? "☾" : "☀"}
          </button>
          <button
            className="pill"
            onClick={() => { setPhotoError(null); setSettingsOpen(true); }}
            title={S["settings.title"]}
            aria-label={S["settings.title"]}
          >
            ⚙
          </button>
          <div className="seg mini" role="group" aria-label={S["lang.aria"]}>
            <button className={lang === "it" ? "seg-btn active" : "seg-btn"} onClick={() => setLang("it")}>
              IT
            </button>
            <button className={lang === "en" ? "seg-btn active" : "seg-btn"} onClick={() => setLang("en")}>
              EN
            </button>
          </div>
        </div>
      </header>

      <div className="toolbar">
        <div className="seg" role="group" aria-label={S["view.aria"]}>
          <button className={viewMode === "sum" ? "seg-btn active" : "seg-btn"} onClick={() => setViewMode("sum")}>
            {S["mode.sum"]}
          </button>
          <button className={viewMode === "split" ? "seg-btn active" : "seg-btn"} onClick={() => setViewMode("split")}>
            {S["mode.split"]}
          </button>
        </div>
        <div className="chips" aria-label={S["providers.aria"]}>
          <button
            className={filters.selected.length === 0 ? "chip active" : "chip"}
            onClick={() => setSelected([])}
          >
            {S["filter.all"]}
          </button>
          {filters.groups.map((g) => (
            <button
              key={g}
              className={filters.selected.includes(g) ? "chip active" : "chip"}
              onClick={() => toggleGroup(g)}
            >
              <ProviderMark group={g} theme={themeName} />
              {g}
            </button>
          ))}
        </div>
        <span className="updated">
          {updatedMs ? `${S["updated"]} ${timeHM(updatedMs, lang)}` : "—"} · {filters.groups.length} {S["providers.count"]}{diagMs != null ? ` · db ${diagMs}ms` : ""}
        </span>
        {filters.selected.length > 0 && (
          <button className="link-btn" onClick={() => setSelected([])}>
            {S["filter.reset"]}
          </button>
        )}
      </div>

      {error && (
        <div className="banner warn" role="alert">
          <span>{error}</span>
          <button className="pill small" onClick={() => void refresh({ manual: true })}>{S["retry"]}</button>
        </div>
      )}

      <section className="kpis">
        <div className="kpi">
          <span className="kpi-label">{S["kpi.input"]}</span>
          <strong className="kpi-value">{totals ? fmtCompact(totals.input) : "—"}</strong>
          <span className="kpi-sub">{totals ? fmtInt(totals.input, lang) : ""}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{S["kpi.output"]}</span>
          <strong className="kpi-value">{totals ? fmtCompact(totals.output) : "—"}</strong>
          <span className="kpi-sub">{totals ? fmtInt(totals.output, lang) : ""}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{S["kpi.cost"]}</span>
          <strong className="kpi-value">{totals ? fmtCost(totals.cost, lang) : "—"}</strong>
          <span className="kpi-sub">{S["kpi.cacheRead"]} {totals ? fmtCompact(totals.cacheRead) : "—"} · {S["kpi.cacheWrite"]} {totals ? fmtCompact(totals.cacheWrite) : "—"}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">{S["kpi.msgsSessions"]}</span>
          <strong className="kpi-value">
            {totals ? `${fmtCompact(totals.messages)} · ${fmtInt(totals.sessions, lang)}` : "—"}
          </strong>
          <span className="kpi-sub">{RANGE_LABEL[range]} · {S["kpi.rangeSub"]} {RANGE_DAYS[range]} {S["kpi.rangeDays"]}</span>
        </div>
      </section>

      <section className="grid-2">
        <div className="card">
          <h2>{range === "weekly" ? S["card.tokensWeek"] : S["card.tokensDay"]}</h2>
          <div ref={tokensRef} className="chart" />
        </div>
        <div className="card">
          <h2>{range === "weekly" ? S["card.costWeek"] : S["card.costDay"]}</h2>
          <div ref={costRef} className="chart" />
        </div>
      </section>

      <section className="grid-2">
        <div className="card">
          <div className="card-head">
            <h2>{S["card.providers"]}</h2>
            <div className="seg mini" role="group" aria-label={S["chartType.aria"]}>
              <button className={profile.providerView === "bars" ? "seg-btn active" : "seg-btn"} onClick={() => setProviderView("bars")}>
                {S["chart.bars"]}
              </button>
              <button className={profile.providerView === "pie" ? "seg-btn active" : "seg-btn"} onClick={() => setProviderView("pie")}>
                {S["chart.pie"]}
              </button>
            </div>
          </div>
          <div ref={profile.providerView === "bars" ? providerChartRef : pieChartRef} className="chart" />
          {profile.providerView === "pie" && providerShare.length > 0 && pieRows.length <= 1 && (
            <p className="card-note">{S["card.singleProviderNote"]}</p>
          )}
        </div>
        <div className="card">
          <h2>{S["card.topModels"]}</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{S["th.model"]}</th>
                  <th>{S["th.provider"]}</th>
                  <th className="num">{S["th.msgs"]}</th>
                  <th className="num">{S["th.input"]}</th>
                  <th className="num">{S["th.output"]}</th>
                  <th className="num">{S["th.cost"]}</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((m) => (
                  <tr key={m.key}>
                    <td className="mono">{m.model}</td>
                    <td><span className="badge"><ProviderMark group={m.group} theme={themeName} />{m.group}</span></td>
                    <td className="num">{fmtInt(m.messages, lang)}</td>
                    <td className="num">{fmtCompact(m.input)}</td>
                    <td className="num">{fmtCompact(m.output)}</td>
                    <td className="num">{fmtCost(m.cost, lang)}</td>
                  </tr>
                ))}
                {!tableRows.length && (
                  <tr><td colSpan={6} className="empty">{S["empty.models"]}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>{S["card.sessions"]}</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{S["th.title"]}</th>
                <th>{S["th.folder"]}</th>
                <th>{S["th.day"]}</th>
                <th className="num">{S["th.input"]}</th>
                <th className="num">{S["th.output"]}</th>
                <th className="num">{S["th.cost"]}</th>
              </tr>
            </thead>
            <tbody>
              {sessions
                .filter((s) => {
                  // Unfiltered: show everything. Filtered: only sessions whose
                  // dominant provider is selected (sessions without message
                  // attribution can't be attributed, so they're hidden).
                  if (selEmpty) return true;
                  const p = sessionProviders.get(s.id);
                  return p !== undefined && filters.selected.includes(providerGroup(p));
                })
                .slice(0, 15)
                .map((s, i) => (
                <tr key={s.id || `${s.day}-${s.title}-${i}`}>
                  <td>{s.title || (s.id ?? "").slice(0, 12)}</td>
                  <td className="mono dim">{(s.directory ?? "").split(/[\\/]/).pop() || s.directory}</td>
                  <td className="mono">{fmtDayIT(s.day ?? "", lang)}</td>
                  <td className="num">{fmtCompact(s.input)}</td>
                  <td className="num">{fmtCompact(s.output)}</td>
                  <td className="num">{fmtCost(s.cost, lang)}</td>
                </tr>
              ))}
              {!sessions.length && (
                <tr><td colSpan={6} className="empty">{S["empty.sessions"]}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="footer">
        <span className="mono dim">
          {dbInfo ? `${dbInfo.path} · ${fmtBytes(dbInfo.sizeBytes)} · ${fmtInt(dbInfo.sessions, lang)} ${S["footer.sessions"]} · ${fmtInt(dbInfo.messages, lang)} ${S["footer.messages"]}` : "db…"}
        </span>
        <span className="dim">{S["footer.build"]} {__BUILD_STAMP__}{diagMs != null ? ` · ${S["footer.db"]} ${diagMs}ms` : ""}{chartDiag ? ` · ${chartDiag}` : ""}{error ? ` · ${S["footer.error"]} ${error.slice(0, 80)}` : ""}</span>
      </footer>

      {settingsOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            // Remember where the press started: a text selection that ends
            // outside the input must NOT count as a backdrop click.
            backdropPressRef.current = e.target === e.currentTarget;
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && backdropPressRef.current) {
              setSettingsOpen(false);
            }
            backdropPressRef.current = false;
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={S["settings.title"]}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              // Minimal focus trap: keep Tab cycling inside the modal.
              if (e.key !== "Tab") return;
              const root = e.currentTarget;
              const items = [...root.querySelectorAll<HTMLElement>(
                'button, input, textarea, select, [tabindex]:not([tabindex="-1"])'
              )].filter((el) => !el.hasAttribute("disabled"));
              if (!items.length) return;
              const first = items[0];
              const last = items[items.length - 1];
              const active = document.activeElement as HTMLElement | null;
              if (e.shiftKey && (active === first || !root.contains(active))) {
                e.preventDefault();
                last.focus();
              } else if (!e.shiftKey && active === last) {
                e.preventDefault();
                first.focus();
              }
            }}
          >
            <div className="modal-head">
              <h2>{S["settings.title"]}</h2>
              <button className="pill small" autoFocus onClick={() => setSettingsOpen(false)}>
                {S["settings.close"]}
              </button>
            </div>
            <div className="field">
              <span className="field-label">{S["settings.photo"]}</span>
              {crop ? (
                <div className="crop-wrap">
                  <div
                    className="crop-stage"
                    onPointerDown={(e) => {
                      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                      dragRef.current = { sx: e.clientX, sy: e.clientY, ox: crop.x, oy: crop.y };
                    }}
                    onPointerMove={(e) => {
                      const d = dragRef.current;
                      if (!d) return;
                      const p = clampPan(d.ox + e.clientX - d.sx, d.oy + e.clientY - d.sy, crop.scale, crop.iw, crop.ih);
                      setCrop({ ...crop, x: p.x, y: p.y });
                    }}
                    onPointerUp={() => { dragRef.current = null; }}
                    onPointerCancel={() => { dragRef.current = null; }}
                    onWheel={(e) => {
                      const next = Math.min(crop.minScale * 3, Math.max(crop.minScale, crop.scale * (e.deltaY > 0 ? 0.92 : 1.08)));
                      const p = clampPan(crop.x, crop.y, next, crop.iw, crop.ih);
                      setCrop({ ...crop, scale: next, x: p.x, y: p.y });
                    }}
                  >
                    <img
                      src={crop.url}
                      alt=""
                      draggable={false}
                      className="crop-img"
                      style={{
                        width: crop.iw * crop.scale,
                        height: crop.ih * crop.scale,
                        left: STAGE / 2 - (crop.iw * crop.scale) / 2 + crop.x,
                        top: STAGE / 2 - (crop.ih * crop.scale) / 2 + crop.y,
                      }}
                    />
                    <div className="crop-mask" />
                  </div>
                  <div className="crop-controls">
                    <span className="field-label">{S["settings.zoom"]}</span>
                    <input
                      type="range"
                      min={crop.minScale}
                      max={crop.minScale * 3}
                      step={crop.minScale / 20}
                      value={crop.scale}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        const p = clampPan(crop.x, crop.y, next, crop.iw, crop.ih);
                        setCrop({ ...crop, scale: next, x: p.x, y: p.y });
                      }}
                      aria-label={S["settings.zoom"]}
                    />
                  </div>
                  <div className="photo-actions">
                    <button className="pill small" onClick={confirmCrop}>
                      {S["settings.confirm"]}
                    </button>
                    <button className="link-btn" onClick={closeCrop}>
                      {S["settings.cancel"]}
                    </button>
                  </div>
                </div>
              ) : (
              <div className="photo-row">
                <span className="avatar large">
                  {profile.photo ? (
                    <img src={profile.photo} alt="" className="avatar-img" />
                  ) : (
                    monogram(profile.name)
                  )}
                </span>
                <div className="photo-actions">
                  <button className="pill small" onClick={() => fileRef.current?.click()}>
                    {S["settings.upload"]}
                  </button>
                  {profile.photo && (
                    <button
                      className="link-btn"
                      onClick={() => setProfile((p) => ({ ...p, photo: "" }))}
                    >
                      {S["settings.remove"]}
                    </button>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      onPhotoFile(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </div>
              </div>
              )}
              {photoError && <p className="field-error" role="alert">{photoError}</p>}
            </div>
            <label className="field">
              <span className="field-label">{S["settings.name"]}</span>
              <input
                className="text-input"
                value={profile.name}
                onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
                maxLength={48}
              />
            </label>
            <label className="field">
              <span className="field-label">
                {S["settings.desc"]} · {profile.desc.length}/{DESC_MAX_LENGTH}
              </span>
              <textarea
                className="text-input"
                value={profile.desc}
                onChange={(e) =>
                  setProfile((p) => ({ ...p, desc: e.target.value.slice(0, DESC_MAX_LENGTH) }))
                }
                rows={2}
                maxLength={DESC_MAX_LENGTH}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
