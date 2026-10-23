"use client";

import { memo } from "react";
import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

import { mergeSeries } from "@/lib/replay/mergeSeries";
import type { ArrivalsPoint } from "@/lib/replay/replay";

export interface ChartSeries {
  id: string;
  label: string;
  color: string;
  points: ArrivalsPoint[];
}

// Chart chrome on the white surface: hairline solid grid, muted ink for
// axes; text never wears a series color (dataviz marks-and-anatomy).
const GRID = "#eef2f6";
const AXIS = "#cbd5e1";
const MUTED_INK = "#64748b";

function formatMinutes(minutes: number): string {
  return Number.isInteger(minutes) ? `${minutes}m` : `${minutes.toFixed(1)}m`;
}

interface TooltipEntry { dataKey?: unknown; value?: unknown; color?: string }

function ChartTooltip({ active, payload, label, series }: {
  active?: boolean; payload?: TooltipEntry[]; label?: unknown; series: ChartSeries[];
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-slate-200 bg-white/95 px-3 py-2 text-xs">
      <div className="mb-1 text-slate-500">T+{formatMinutes(Number(label))}</div>
      {series.map((s) => {
        const entry = payload.find((p) => p.dataKey === s.id);
        if (!entry) return null;
        return (
          <div key={s.id} className="flex items-center gap-2">
            <span aria-hidden className="h-0.5 w-3" style={{ backgroundColor: s.color }} />
            <span className="font-semibold tabular-nums text-slate-900">{String(entry.value)}</span>
            <span className="text-slate-500">{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}

interface ArrivalsChartProps {
  series: ChartSeries[];
  /** Total evacuees — the ceiling every curve is measured against. */
  total: number;
  /** Optional playback position, drawn as a vertical hairline. */
  cursorMinute?: number;
  height?: number;
}

/** Cumulative evacuees in shelter over time. One series = area; 2+ = lines with legend and end labels. */
export const ArrivalsChart = memo(function ArrivalsChart({ series, total, cursorMinute, height = 200 }: ArrivalsChartProps) {
  const rows = mergeSeries(series);
  const single = series.length === 1;
  const lastIndex = rows.length - 1;
  // End labels only when the line ends are clearly apart; colliding labels
  // are never nudged or stacked — the legend + tooltip carry identity instead.
  const endValues = series.map((s) => rows[lastIndex]?.[s.id] ?? 0);
  const minGap = Math.max(total, 1) * 0.06;
  const endLabels = !single && endValues.every((v, i) => endValues.every((w, j) => i === j || Math.abs(v - w) >= minGap));

  return (
    <figure>
      {!single && (
        <ul className="mb-2 flex flex-wrap gap-4 text-xs text-slate-500" aria-label="Chart legend">
          {series.map((s) => (
            <li key={s.id} className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-4" style={{ backgroundColor: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: endLabels ? 72 : 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis
              dataKey="minutes" type="number" domain={[0, "dataMax"]} tickFormatter={formatMinutes}
              stroke={AXIS} tick={{ fill: MUTED_INK, fontSize: 11 }} tickLine={false}
            />
            <YAxis
              domain={[0, Math.max(total, 1)]} allowDecimals={false} width={40}
              stroke={AXIS} tick={{ fill: MUTED_INK, fontSize: 11 }} tickLine={false}
            />
            <Tooltip
              content={<ChartTooltip series={series} />}
              cursor={{ stroke: "#94a3b8", strokeWidth: 1 }}
              isAnimationActive={false}
            />
            <ReferenceLine
              y={total} stroke={AXIS}
              label={{ value: `All ${total} evacuees`, position: "insideTopLeft", fill: MUTED_INK, fontSize: 11 }}
            />
            {cursorMinute !== undefined && <ReferenceLine x={cursorMinute} stroke="#94a3b8" />}
            {series.map((s) =>
              single ? (
                <Area
                  key={s.id} dataKey={s.id} name={s.label} type="stepAfter"
                  stroke={s.color} strokeWidth={2} fill={s.color} fillOpacity={0.1}
                  dot={false} activeDot={{ r: 4, stroke: "#ffffff", strokeWidth: 2 }} isAnimationActive={false}
                />
              ) : (
                <Line
                  key={s.id} dataKey={s.id} name={s.label} type="stepAfter"
                  stroke={s.color} strokeWidth={2} dot={false}
                  activeDot={{ r: 4, stroke: "#ffffff", strokeWidth: 2 }} isAnimationActive={false}
                  label={({ index, x, y }: { index?: number; x?: number | string; y?: number | string }) =>
                    endLabels && index === lastIndex ? (
                      <text key={s.id} x={Number(x) + 8} y={Number(y)} dy={4} fill="#334155" fontSize={11}>{s.label}</text>
                    ) : <g key={`${s.id}-${index}`} />
                  }
                />
              ),
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-2 text-xs text-slate-500">
        <summary className="cursor-pointer select-none hover:text-slate-800">Show as table</summary>
        <div className="mt-2 max-h-48 overflow-y-auto">
          <table className="w-full text-left tabular-nums">
            <thead className="sticky top-0 bg-white text-slate-500">
              <tr>
                <th scope="col" className="py-1 font-medium">Time</th>
                {series.map((s) => <th key={s.id} scope="col" className="py-1 text-right font-medium">{s.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.minutes} className="border-t border-slate-200">
                  <td className="py-0.5">T+{formatMinutes(row.minutes)}</td>
                  {series.map((s) => <td key={s.id} className="py-0.5 text-right text-slate-700">{row[s.id]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
});
