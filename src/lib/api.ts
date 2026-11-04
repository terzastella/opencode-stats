import { invokeWithTimeout } from "./tauri-safe";
import type { Dashboard, DbInfo, SelectionStats, SessionRow, Watermark } from "./types";
import { demoDashboard, demoDb, demoSessions, isDemo, isSkewedDemo } from "./demo";

// Heavy scans can parse ~1 GB of message JSON on large v2 databases. They run
// off the UI thread (see src-tauri/src/lib.rs), so a long timeout only risks
// a late error banner, never a frozen window — while a short one would turn a
// slow cold scan into a spurious error plus a queued retry.
const HEAVY_TIMEOUT_MS = 60_000;
// Light commands (cheap metadata/count probes) stay short so a wedged
// backend surfaces quickly.
const LIGHT_TIMEOUT_MS = 15_000;

async function callLight<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return await invokeWithTimeout<T>(cmd, args, LIGHT_TIMEOUT_MS);
}

async function callHeavy<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return await invokeWithTimeout<T>(cmd, args, HEAVY_TIMEOUT_MS);
}

const demo = typeof window !== "undefined" && isDemo();

export const api = {
  dbInfo: () => (demo ? Promise.resolve(demoDb()) : callLight<DbInfo>("db_info")),
  watermark: () =>
    demo
      // Always-changing stub so demo mode never takes the skip path.
      ? Promise.resolve({
          maxMessageMs: Date.now(),
          maxSessionMs: Date.now(),
          messages: 0,
          sessions: 0,
        } as Watermark)
      : callLight<Watermark>("watermark"),
  sessionList: (days: number, limit: number) =>
    demo
      ? Promise.resolve(demoSessions().slice(0, limit))
      : callHeavy<SessionRow[]>("session_list", { days, limit }),
  /** Combined payload: overview + daily + models in a single backend scan. */
  dashboard: (days: number) =>
    demo
      ? Promise.resolve(demoDashboard(isSkewedDemo(), days))
      : callHeavy<Dashboard>("dashboard", { days }),
  /**
   * Selection honesty data (sessions per model + dominant provider per
   * session). Called only when a provider filter is active; demo returns [].
   */
  selectionStats: (days: number) =>
    demo
      ? Promise.resolve({ session_stats: [] } as SelectionStats)
      : callHeavy<SelectionStats>("selection_stats", { days }),
};

export function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  // Tauri v2 always exposes __TAURI_INTERNALS__; __TAURI__ exists only with
  // app.withGlobalTauri, which we don't enable. Check both.
  return w.__TAURI_INTERNALS__ !== undefined || w.__TAURI__ !== undefined;
}
