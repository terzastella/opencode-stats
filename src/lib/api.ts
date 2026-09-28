import { invokeWithTimeout } from "./tauri-safe";
import type { Dashboard, DbInfo, SelectionStats, SessionRow, Watermark } from "./types";
import { demoDashboard, demoDb, demoSessions, isDemo, isSkewedDemo } from "./demo";

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  // 15s: well above the worst cold scan, well below the 30s refresh tick.
  return await invokeWithTimeout<T>(cmd, args, 15000);
}

const demo = typeof window !== "undefined" && isDemo();

export const api = {
  dbInfo: () => (demo ? Promise.resolve(demoDb()) : call<DbInfo>("db_info")),
  watermark: () =>
    demo
      // Always-changing stub so demo mode never takes the skip path.
      ? Promise.resolve({
          maxMessageMs: Date.now(),
          maxSessionMs: Date.now(),
          messages: 0,
          sessions: 0,
        } as Watermark)
      : call<Watermark>("watermark"),
  sessionList: (days: number, limit: number) =>
    demo
      ? Promise.resolve(demoSessions().slice(0, limit))
      : call<SessionRow[]>("session_list", { days, limit }),
  /** Combined payload: overview + daily + models in a single backend scan. */
  dashboard: (days: number) =>
    demo
      ? Promise.resolve(demoDashboard(isSkewedDemo(), days))
      : call<Dashboard>("dashboard", { days }),
  /**
   * Selection honesty data (sessions per model + dominant provider per
   * session). Called only when a provider filter is active; demo returns [].
   */
  selectionStats: (days: number) =>
    demo
      ? Promise.resolve({ session_stats: [] } as SelectionStats)
      : call<SelectionStats>("selection_stats", { days }),
};

export function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  // Tauri v2 always exposes __TAURI_INTERNALS__; __TAURI__ exists only with
  // app.withGlobalTauri, which we don't enable. Check both.
  return w.__TAURI_INTERNALS__ !== undefined || w.__TAURI__ !== undefined;
}
