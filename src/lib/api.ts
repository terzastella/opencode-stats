import { invoke } from "@tauri-apps/api/core";
import type { Dashboard, DayStat, DbInfo, ModelStat, Overview, SessionRow } from "./types";
import { demoDashboard, demoDb, demoSessions, isDemo, isSkewedDemo } from "./demo";

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return await invoke<T>(cmd, args);
}

const demo = typeof window !== "undefined" && isDemo();

export const api = {
  dbInfo: () => (demo ? Promise.resolve(demoDb()) : call<DbInfo>("db_info")),
  overview: (days: number) => call<Overview>("overview", { days }),
  dailyStats: (days: number) => call<DayStat[]>("daily_stats", { days }),
  modelStats: (days: number) => call<ModelStat[]>("model_stats", { days }),
  sessionList: (days: number, limit: number) =>
    demo
      ? Promise.resolve(demoSessions().slice(0, limit))
      : call<SessionRow[]>("session_list", { days, limit }),
  /** Combined payload: overview + daily + models in a single backend scan. */
  dashboard: (days: number) =>
    demo
      ? Promise.resolve(demoDashboard(isSkewedDemo()))
      : call<Dashboard>("dashboard", { days }),
};

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}
