"use client";

import { useAlerts } from "@/lib/alerts/AlertsContext";
import type { FlowForecast as Forecast } from "@/lib/api/client";

const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const LEVEL_STYLE = { normal: "text-slate-700", warning: "text-amber-700", severe: "text-red-700", extreme: "text-red-800" } as const;

/** Today's modelled flow and the coming days' likely peak, against the area's own flood flows. */
export function FlowLine({ forecast: f }: { forecast: Forecast }) {
  return (
    <p className="mt-1 text-xs text-slate-600">
      Today {Math.round(f.todayM3s)} m³/s · likely peak{" "}
      <strong className={`tabular-nums ${LEVEL_STYLE[f.level]}`}>{Math.round(f.peakM3s)} m³/s</strong> on {day(f.peakDate)}
      {" "}(next {f.lookaheadDays} days). Flood flows: 2-year {f.thresholdsM3s.warning}, 5-year {f.thresholdsM3s.severe},
      20-year {f.thresholdsM3s.extreme} m³/s.
    </p>
  );
}

/** On the river card: the GloFAS forecast, clearly apart from the gauge reading. */
export function FlowForecast({ river }: { river: string }) {
  const forecast = useAlerts().overview?.sources.glofas?.forecast;
  if (!forecast || forecast.river !== river) return null;
  return (
    <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-2">
      <p className="font-medium text-slate-700">Flow forecast (GloFAS model, ~5 km area, not a gauge)</p>
      <FlowLine forecast={forecast} />
    </div>
  );
}
