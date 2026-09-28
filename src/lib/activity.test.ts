import { describe, expect, it } from "vitest";
import {
  aggregateDayBreakdown,
  aggregateTokensByDay,
  buildHeatmapWeeks,
  granularityForSpan,
  lastNDays,
  levelFor,
  monthKey,
  placeTip,
  sortedActiveValues,
} from "./activity";
import type { DayStat } from "./types";

function row(day: string, provider: string, input: number, output: number, reasoning: number): DayStat {
  return {
    day,
    provider,
    model: "m",
    messages: 1,
    input,
    output,
    reasoning,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
  };
}

describe("lastNDays", () => {
  it("returns n ascending ISO days ending today", () => {
    const days = lastNDays(3);
    expect(days).toHaveLength(3);
    expect(days[0] < days[1]).toBe(true);
    expect(days[1] < days[2]).toBe(true);
    for (const d of days) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("monthKey", () => {
  it("extracts YYYY-MM", () => {
    expect(monthKey("2026-09-27")).toBe("2026-09");
    expect(monthKey("xx")).toBeNull();
  });
});

describe("granularityForSpan", () => {
  it("picks day/week/month by span", () => {
    expect(granularityForSpan(0)).toBe("day");
    expect(granularityForSpan(90)).toBe("day");
    expect(granularityForSpan(91)).toBe("week");
    expect(granularityForSpan(540)).toBe("week");
    expect(granularityForSpan(541)).toBe("month");
  });
});

describe("aggregateTokensByDay", () => {
  const days = ["2026-09-25", "2026-09-26", "2026-09-27"];
  it("sums input+output+reasoning and fills missing days", () => {
    const rows = [
      row("2026-09-27", "opencode/m", 100, 50, 25),
      row("2026-09-27", "ollama/m", 10, 5, 0),
    ];
    const m = aggregateTokensByDay(rows, () => true, days);
    expect(m.get("2026-09-27")).toBe(190);
    expect(m.get("2026-09-26")).toBe(0);
  });
  it("respects the provider filter", () => {
    const rows = [row("2026-09-27", "ollama/m", 10, 5, 0)];
    const m = aggregateTokensByDay(rows, (g) => g === "opencode", days);
    expect(m.get("2026-09-27")).toBe(0);
  });
});

describe("aggregateDayBreakdown", () => {
  const days = ["2026-09-26", "2026-09-27"];
  it("splits input/output/reasoning with total", () => {
    const rows = [
      row("2026-09-27", "opencode/m", 100, 50, 25),
      row("2026-09-27", "ollama/m", 10, 5, 0),
    ];
    const m = aggregateDayBreakdown(rows, () => true, days);
    expect(m.get("2026-09-27")).toEqual({ input: 110, output: 55, reasoning: 25, total: 190 });
    expect(m.get("2026-09-26")).toEqual({ input: 0, output: 0, reasoning: 0, total: 0 });
  });
  it("header math holds: input+output+reasoning === total", () => {
    const rows = [row("2026-09-27", "opencode/m", 7, 3, 2)];
    const b = aggregateDayBreakdown(rows, () => true, days).get("2026-09-27")!;
    expect(b.input + b.output + b.reasoning).toBe(b.total);
  });
});

describe("buildHeatmapWeeks", () => {
  it("totals and bounds the grid", () => {
    const days = lastNDays(14);
    const totals = new Map(days.map((d, i) => [d, i * 10] as [string, number]));
    const { weeks, total, max } = buildHeatmapWeeks(days, totals, "it");
    expect(total).toBe(10 * (13 * 14) / 2);
    expect(max).toBe(130);
    expect(weeks.length).toBeLessThanOrEqual(3);
    for (const w of weeks) expect(w.cells.length).toBe(7);
  });
});

describe("levelFor", () => {
  it("maps zero and quartiles", () => {
    expect(levelFor(0, [1, 2, 3, 4])).toBe(0);
    expect(levelFor(5, [])).toBe(0);
    expect(levelFor(1, [1, 2, 3, 4])).toBe(1);
    expect(levelFor(10, [1, 2, 3, 4])).toBe(4);
  });
});

describe("placeTip", () => {
  it("opens down-right by default", () => {
    expect(placeTip(100, 100, 190, 122, 1000, 800)).toEqual({ left: 114, top: 114 });
  });
  it("flips left near the right edge", () => {
    expect(placeTip(950, 100, 190, 122, 1000, 800)).toEqual({ left: 746, top: 114 });
  });
  it("flips up near the bottom edge", () => {
    expect(placeTip(100, 750, 190, 122, 1000, 800)).toEqual({ left: 114, top: 614 });
  });
  it("flips both in the corner and clamps", () => {
    expect(placeTip(990, 790, 190, 122, 1000, 800)).toEqual({ left: 786, top: 654 });
    expect(placeTip(0, 0, 2000, 2000, 1000, 800)).toEqual({ left: 4, top: 4 });
  });
});

describe("sortedActiveValues", () => {
  it("drops zeros and sorts", () => {
    expect(sortedActiveValues(new Map([["a", 0], ["b", 5], ["c", 2]]))).toEqual([2, 5]);
  });
});
