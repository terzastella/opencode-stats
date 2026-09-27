import { describe, expect, it } from "vitest";
import { escapeHtml, fmtCompact, fmtCost, fmtDayIT, fmtInt, fmtMonth } from "./format";

describe("fmtCompact", () => {
  it("scales millions and thousands", () => {
    expect(fmtCompact(262_500_000)).toBe("262.5M");
    expect(fmtCompact(17_500)).toBe("17.5K");
  });
  it("leaves small numbers alone", () => {
    expect(fmtCompact(999)).toBe("999");
    expect(fmtCompact(0)).toBe("0");
  });
});

describe("fmtCost", () => {
  it("formats zero and sub-dollar values", () => {
    expect(fmtCost(0)).toBe("$0");
    expect(fmtCost(0.05)).toBe("$0.0500");
  });
  it("formats dollars with two decimals", () => {
    expect(fmtCost(1.5)).toBe("$1.50");
  });
});

describe("fmtInt", () => {
  it("groups by locale", () => {
    expect(fmtInt(1_000_000, "en")).toBe("1,000,000");
    expect(fmtInt(1_234_567, "it")).toBe("1.234.567");
  });
});

describe("fmtDayIT", () => {
  it("formats ISO days per language", () => {
    expect(fmtDayIT("2026-09-27", "it")).toBe("27/09");
    expect(fmtDayIT("2026-09-27", "en")).toBe("09/27");
  });
  it("passes through garbage", () => {
    expect(fmtDayIT("nope", "it")).toBe("nope");
  });
});

describe("fmtMonth", () => {
  it("formats YYYY-MM buckets", () => {
    expect(fmtMonth("2026-09")).toBe("09/2026");
  });
  it("passes through garbage", () => {
    expect(fmtMonth("xx")).toBe("xx");
  });
});

describe("escapeHtml", () => {
  it("escapes metacharacters for ECharts HTML sinks", () => {
    expect(escapeHtml(`<b>"&</b>`)).toBe(`&lt;b&gt;&quot;&amp;&lt;/b&gt;`);
    expect(escapeHtml(`'quote'`)).toBe(`&#39;quote&#39;`);
  });
  it("leaves plain provider names untouched", () => {
    expect(escapeHtml("ollama/qwen3:8b")).toBe("ollama/qwen3:8b");
  });
});
