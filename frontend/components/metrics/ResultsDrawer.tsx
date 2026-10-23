"use client";

import { useState } from "react";
import type { RunResult } from "@/lib/schemas/types";
import { formatCompletionTick, formatOccupancy } from "@/lib/metrics/format";

interface ResultsDrawerProps {
  result: RunResult | null;
  tickSeconds: number;
}

export function ResultsDrawer({ result, tickSeconds }: ResultsDrawerProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (!result) {
    return (
      <div className="border-t border-slate-800 bg-slate-900 p-4 text-sm text-slate-500">
        Run a simulation to see results here.
      </div>
    );
  }

  return (
    <div className={`shrink-0 border-t border-slate-800 bg-slate-900 transition-all ${collapsed ? "h-10 overflow-hidden" : "max-h-72 overflow-y-auto"}`}>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className="flex w-full items-center justify-between px-4 py-2 text-sm text-slate-300 hover:bg-slate-800/50"
      >
        <span>Results — {result.planLabel} · seed {result.randomSeed}</span>
        <span>{collapsed ? "Expand" : "Collapse"}</span>
      </button>

      {!collapsed && (
        <div className="grid grid-cols-2 gap-3 px-4 pb-4 sm:grid-cols-4">
          <StatTile label="Evacuated" value={result.metrics.evacuatedCount} tone="good" />
          <StatTile label="Unserved" value={result.metrics.unservedCount} tone={result.metrics.unservedCount > 0 ? "bad" : "good"} />
          <StatTile
            label="Completion"
            value={formatCompletionTick(result.metrics.completionTick, result.metrics.hitTickLimit, tickSeconds)}
            tone={result.metrics.hitTickLimit ? "warn" : "good"}
          />
          <StatTile
            label="Peak congestion"
            value={`${result.metrics.maxCongestionRatio.toFixed(2)}x`}
            tone={result.metrics.maxCongestionRatio > 1.5 ? "bad" : "good"}
          />

          <div className="col-span-2 sm:col-span-4">
            <h3 className="mb-1 text-xs uppercase tracking-wide text-slate-500">Shelter occupancy</h3>
            <ul className="flex flex-wrap gap-3 text-sm">
              {result.shelters.map((s) => (
                <li key={s.shelterId} className="rounded border border-slate-700 px-2 py-1">
                  {s.shelterId}: {formatOccupancy(s.finalOccupied, s.totalCapacity)}
                  {s.rejectedCount > 0 && <span className="ml-1 text-amber-400">({s.rejectedCount} rejected)</span>}
                </li>
              ))}
            </ul>
          </div>

          {result.warnings.length > 0 && (
            <div role="alert" className="col-span-2 text-xs text-amber-400 sm:col-span-4">
              {result.warnings.length} warning(s) — e.g. &quot;{result.warnings[0]}&quot;
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, tone }: { label: string; value: string | number; tone: "good" | "bad" | "warn" }) {
  const toneClass = tone === "good" ? "text-green-400" : tone === "bad" ? "text-red-400" : "text-amber-400";
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}
