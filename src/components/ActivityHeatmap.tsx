import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  aggregateDayBreakdown,
  aggregateTokensByDay,
  buildHeatmapWeeks,
  lastNDays,
  levelFor,
  placeTip,
  sortedActiveValues,
  type GroupPass,
} from "../lib/activity";
import { fmtCompact, fmtDayIT } from "../lib/format";
import { STRINGS, type Lang } from "../lib/i18n";
import type { DayStat } from "../lib/types";

interface Props {
  rows: DayStat[] | null;
  loading: boolean;
  loadError: boolean;
  onRetry: () => void;
  lang: Lang;
  groupPass: GroupPass;
}

const YEAR_DAYS = 182;

/** GitHub-style half-year activity grid (Monday-first columns, token totals). */
export default function ActivityHeatmap({ rows, loading, loadError, onRetry, lang, groupPass }: Props) {
  const S = STRINGS[lang];

  const data = useMemo(() => {
    if (!rows) return null;
    const days = lastNDays(YEAR_DAYS);
    const breakdown = aggregateDayBreakdown(rows, groupPass, days);
    const totals = aggregateTokensByDay(rows, groupPass, days);
    const { weeks, total, max } = buildHeatmapWeeks(days, totals, lang);
    let input = 0;
    let output = 0;
    let reasoning = 0;
    for (const b of breakdown.values()) {
      input += b.input;
      output += b.output;
      reasoning += b.reasoning;
    }
    return {
      weeks,
      total,
      max,
      totals,
      breakdown,
      input,
      output,
      reasoning,
      first: days[0],
      last: days[days.length - 1],
      active: sortedActiveValues(totals),
    };
  }, [rows, lang, groupPass]);

  // Hooks first, unconditionally: anything below the early returns must
  // not call hooks (React would see a different hook count per render).
  // Instant custom hover tooltip (no native title delay).
  const [hover, setHover] = useState<{ day: string; x: number; y: number } | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [tipSize, setTipSize] = useState({ w: 190, h: 122 });
  useLayoutEffect(() => {
    if (hover && tipRef.current) {
      const r = tipRef.current.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setTipSize({ w: Math.ceil(r.width), h: Math.ceil(r.height) });
    }
  }, [hover]);
  const hoverData = hover && data ? data.breakdown.get(hover.day) : undefined;
  const tipPos = hover
    ? placeTip(hover.x, hover.y, tipSize.w, tipSize.h, window.innerWidth, window.innerHeight)
    : null;

  // Error first: reachable even when rows is null (e.g. dev without backend).
  if (loadError && !loading) {
    return (
      <div className="heatmap">
        <div className="heatmap-head">
          <span className="heatmap-title">{S["activity.loadError"]}</span>
          <button className="link-btn" onClick={onRetry}>
            {S["retry"]}
          </button>
        </div>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="heatmap" aria-busy="true">
        <div className="heatmap-head">
          <span className="heatmap-title">{S["activity.loading"]}</span>
        </div>
        <div className="heatmap-scroll" aria-hidden="true">
          <div className="heatmap-months">
            {Array.from({ length: 12 }, (_, i) => (
              <span key={i} className="heatmap-month">
                ·
              </span>
            ))}
          </div>
          <div className="heatmap-body">
            <div className="heatmap-days">
              <span>{S["activity.mon"]}</span>
              <span>{S["activity.wed"]}</span>
              <span>{S["activity.fri"]}</span>
            </div>
            <div className="heatmap-grid">
              {Array.from({ length: 30 }, (_, w) => (
                <div className="heatmap-col" key={w}>
                  {Array.from({ length: 7 }, (_, d) => (
                    <span className="heat heat-skel" key={d} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const { weeks, total, input, output, reasoning, first, last, active } = data;

  if (total <= 0) {
    return (
      <div className="heatmap">
        <div className="heatmap-head">
          <span className="heatmap-title">{S["activity.empty"]}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="heatmap"
      role="img"
      aria-label={`${fmtCompact(total)} ${S["activity.title"]}`}
    >
      <div className="heatmap-head">
        <span className="heatmap-title">
          {fmtCompact(total)} {S["activity.title"]}
        </span>
      </div>
      <div className="heatmap-how">
        {S["series.input"]} {fmtCompact(input)} · {S["series.output"]} {fmtCompact(output)} ·{" "}
        {S["series.reasoning"]} {fmtCompact(reasoning)}
      </div>
      <div className="heatmap-scroll" onScroll={() => setHover(null)}>
        <div className="heatmap-months" aria-hidden="true">
          {weeks.map((w, i) => (
            <span key={i} className="heatmap-month">
              {w.monthLabel ?? ""}
            </span>
          ))}
        </div>
        <div className="heatmap-body">
          <div className="heatmap-days" aria-hidden="true">
            <span>{S["activity.mon"]}</span>
            <span>{S["activity.wed"]}</span>
            <span>{S["activity.fri"]}</span>
          </div>
          <div className="heatmap-grid" onMouseLeave={() => setHover(null)}>
            {weeks.map((w, wi) => (
              <div className="heatmap-col" key={wi}>
                {w.cells.map((c, ci) => {
                  if (!c) return <span className="heat heat-pad" key={ci} />;
                  const lv = levelFor(c.value, active);
                  return (
                    <span
                      key={ci}
                      className={`heat heat-${lv}`}
                      onMouseEnter={(e) => setHover({ day: c.day, x: e.clientX, y: e.clientY })}
                      onMouseMove={(e) => setHover({ day: c.day, x: e.clientX, y: e.clientY })}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="heatmap-foot">
          <span className="heatmap-how">
            {fmtDayIT(first, lang)} – {fmtDayIT(last, lang)} · {S["activity.howWeCount"]}
          </span>
          <span className="heatmap-legend">
            {S["activity.less"]}
            {[0, 1, 2, 3, 4].map((l) => (
              <span key={l} className={`heat heat-${l} heat-key`} aria-hidden="true" />
            ))}
            {S["activity.more"]}
          </span>
        </div>
      </div>
      {hover && hoverData && tipPos && (
        <div ref={tipRef} className="heat-tip" style={{ left: tipPos.left, top: tipPos.top }}>
          <div className="heat-tip-day">{fmtDayIT(hover.day, lang)}</div>
          <div className="heat-tip-row">
            <span className="heat-dot in" />
            <span>{S["series.input"]}</span>
            <strong>{fmtCompact(hoverData.input)}</strong>
          </div>
          <div className="heat-tip-row">
            <span className="heat-dot out" />
            <span>{S["series.output"]}</span>
            <strong>{fmtCompact(hoverData.output)}</strong>
          </div>
          <div className="heat-tip-row">
            <span className="heat-dot rea" />
            <span>{S["series.reasoning"]}</span>
            <strong>{fmtCompact(hoverData.reasoning)}</strong>
          </div>
          <div className="heat-tip-total">
            <span>{S["kpi.totalGenerated"]}</span>
            <strong>{fmtCompact(hoverData.total)}</strong>
          </div>
        </div>
      )}
    </div>
  );
}
