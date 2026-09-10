import type { Dashboard, DbInfo, DayStat, SessionRow } from "./types";

/**
 * Demo dataset (?demo in URL, ?demo=skewed for a dominant-provider
 * distribution like real data) for UI testing without Tauri backend.
 * Also useful for screenshots and GitHub previews.
 */
function daysBack(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export const DEMO_DAYS = 14;

export function demoDb(): DbInfo {
  return { path: "demo/opencode.db", exists: true, sizeBytes: 123456, sessions: 12, messages: 340 };
}

export function demoDashboard(skewed = false): Dashboard {
  const providers: Array<[string, string, number]> = skewed
    ? [
        ["opencode", "demo-model-a", 2_200_000],
        ["nvidia", "demo-model-c", 140_000],
        ["ollama", "demo-model-b", 45_000],
      ]
    : [
        ["opencode", "demo-model-a", 1_200_000],
        ["ollama", "demo-model-b", 800_000],
        ["nvidia", "demo-model-c", 400_000],
      ];
  const daily: DayStat[] = [];
  const models = providers.map(([provider, model, base], pi) => {
    let input = 0;
    let output = 0;
    for (let d = DEMO_DAYS - 1; d >= 0; d--) {
      const inp = Math.round(base * (0.5 + ((d * 7 + pi * 13) % 10) / 14));
      const out = Math.round(inp * 0.08);
      input += inp;
      output += out;
      daily.push({
        day: daysBack(d),
        provider,
        model,
        messages: 10 + ((d + pi) % 20),
        input: inp,
        output: out,
        cacheRead: inp * 3,
        cacheWrite: 0,
        cost: pi === 2 ? 0.12 : 0,
      });
    }
    return {
      provider,
      model,
      messages: 120 + pi * 40,
      input,
      output,
      cacheRead: input * 3,
      cacheWrite: 0,
      cost: pi === 2 ? 1.68 : 0,
    };
  });
  const input = models.reduce((a, m) => a + m.input, 0);
  const output = models.reduce((a, m) => a + m.output, 0);
  return {
    overview: {
      sessions: 12,
      messages: 340,
      input,
      output,
      cacheRead: input * 3,
      cacheWrite: 0,
      cost: 1.68,
    },
    daily,
    models,
  };
}

export function demoSessions(): SessionRow[] {
  return Array.from({ length: 8 }, (_, i) => ({
    id: `ses_demo${i}`,
    title: `Demo session ${i + 1}`,
    directory: "D:\\demo\\project",
    cost: i === 0 ? 1.68 : 0,
    input: 1_000_000 - i * 100_000,
    output: 80_000 - i * 8_000,
    cacheRead: 3_000_000,
    day: daysBack(i % 5),
    updatedMs: Date.now() - i * 3_600_000,
  }));
}

export function isDemo(): boolean {
  try {
    return new URLSearchParams(window.location.search).has("demo");
  } catch {
    return false;
  }
}

/** ?demo=skewed mimics real data: one dominant provider (~92%). */
export function isSkewedDemo(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("demo") === "skewed";
  } catch {
    return false;
  }
}

/** ?view=pie|bars forces the provider chart in demo mode (for screenshots). */
export function demoView(): "pie" | "bars" | null {
  try {
    const v = new URLSearchParams(window.location.search).get("view");
    return v === "pie" || v === "bars" ? v : null;
  } catch {
    return null;
  }
}

/** ?demo=settings opens the settings panel on boot (for screenshots). */
export function demoSettings(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("demo") === "settings";
  } catch {
    return false;
  }
}

/** ?lang=it|en forces the language in demo mode (for screenshots). */
export function demoLang(): "it" | "en" | null {
  try {
    const v = new URLSearchParams(window.location.search).get("lang");
    return v === "it" || v === "en" ? v : null;
  } catch {
    return null;
  }
}
