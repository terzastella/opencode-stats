export interface DbInfo {
  path: string;
  exists: boolean;
  sizeBytes: number;
  sessions: number;
  messages: number;
}

export interface Overview {
  sessions: number;
  messages: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export interface DayStat {
  day: string; // YYYY-MM-DD
  provider: string;
  model: string;
  messages: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export interface ModelStat {
  provider: string;
  model: string;
  messages: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export interface SessionRow {
  id: string;
  title: string;
  directory: string;
  cost: number;
  input: number;
  output: number;
  cacheRead: number;
  day: string;
  updatedMs: number;
}

export interface ModelSessions {
  provider: string;
  model: string;
  sessions: number;
}

export interface SessionProvider {
  sessionId: string;
  provider: string;
}

export interface SelectionStats {
  modelSessions: ModelSessions[];
  sessionProviders: SessionProvider[];
}

/** Single-scan dashboard payload (overview + daily + models). */
export interface Dashboard {
  overview: Overview;
  daily: DayStat[];
  models: ModelStat[];
}

/** Provider group = text before first "/" (e.g. "ollama/qwen3:8b" -> "ollama"). */
/** Never throws: unexpected DB values map to "unknown" instead of crashing render. */
export function providerGroup(provider: string | null | undefined): string {
  if (typeof provider !== "string" || !provider) return "unknown";
  const i = provider.indexOf("/");
  return (i > 0 ? provider.slice(0, i) : provider).toLowerCase();
}

export interface Bucket {
  key: string;
  label: string;
  input: number;
  output: number;
  cost: number;
  messages: number;
}
