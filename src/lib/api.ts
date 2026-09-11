import { invoke } from "@tauri-apps/api/core";
import type { Dashboard, DbInfo, SelectionStats, SessionRow } from "./types";
import { demoDashboard, demoDb, demoSessions, isDemo, isSkewedDemo } from "./demo";

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return await invoke<T>(cmd, args);
}

const demo = typeof window !== "undefined" && isDemo();

export const api = {
  dbInfo: () => (demo ? Promise.resolve(demoDb()) : call<DbInfo>("db_info")),
  sessionList: (days: number, limit: number) =>
    demo
      ? Promise.resolve(demoSessions().slice(0, limit))
      : call<SessionRow[]>("session_list", { days, limit }),
  /** Combined payload: overview + daily + models in a single backend scan. */
  dashboard: (days: number) =>
    demo
      ? Promise.resolve(demoDashboard(isSkewedDemo()))
      : call<Dashboard>("dashboard", { days }),
  /**
   * Selection honesty data (sessions per model + dominant provider per
   * session). Called only when a provider filter is active; demo returns [].
   */
  selectionStats: (days: number) =>
    demo
      ? Promise.resolve({ modelSessions: [], sessionProviders: [] } as SelectionStats)
      : call<SelectionStats>("selection_stats", { days }),
};

export function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  // Tauri v2 always exposes __TAURI_INTERNALS__; __TAURI__ exists only with
  // app.withGlobalTauri, which we don't enable. Check both.
  return w.__TAURI_INTERNALS__ !== undefined || w.__TAURI__ !== undefined;
}
