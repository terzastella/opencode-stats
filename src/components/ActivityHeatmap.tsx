import { useMemo } from "react";
import {
  aggregateTokensByDay,
  buildHeatmapWeeks,
  lastNDays,
  levelFor,
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
    const totals = aggregateTokensByDay(rows, groupPass, days);
    const { weeks, total, max } = buildHeatmapWeeks(days, totals, lang);
    return { weeks, total, max, totals, active: sortedActiveValues(totals) };
  }, [rows, lang, groupPass]);

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
              <span>Mon</span>
              <span>Wed</span>
              <span>Fri</span>
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

  const { weeks, total, totals, active } = data;
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
      <div className="heatmap-scroll">
        <div className="heatmap-months" aria-hidden="true">
          {weeks.map((w, i) => (
            <span key={i} className="heatmap-month">
              {w.monthLabel ?? ""}
            </span>
          ))}
        </div>
        <div className="heatmap-body">
          <div className="heatmap-days" aria-hidden="true">
            <span>Mon</span>
            <span>Wed</span>
            <span>Fri</span>
          </div>
          <div className="heatmap-grid">
            {weeks.map((w, wi) => (
              <div className="heatmap-col" key={wi}>
                {w.cells.map((c, ci) => {
                  if (!c) return <span className="heat heat-pad" key={ci} />;
                  const lv = levelFor(c.value, active);
                  const v = totals.get(c.day) ?? 0;
                  return (
                    <span
                      key={ci}
                      className={`heat heat-${lv}`}
                      title={`${fmtCompact(v)} tokens · ${fmtDayIT(c.day, lang)}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="heatmap-foot">
          <span className="heatmap-how">{S["activity.howWeCount"]}</span>
          <span className="heatmap-legend">
            {S["activity.less"]}
            {[0, 1, 2, 3, 4].map((l) => (
              <span key={l} className={`heat heat-${l} heat-key`} aria-hidden="true" />
            ))}
            {S["activity.more"]}
          </span>
        </div>
      </div>
    </div>
  );
}
