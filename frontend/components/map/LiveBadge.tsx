import { Radio } from "lucide-react";

import { areaAlerts, SEVERITY_RANK } from "@/lib/alerts/alerts";
import type { AlertsOverview } from "@/lib/api/client";

/**
 * Summary of live conditions: official and river alerts, and current traffic on covered roads.
 * Top-left under the data note, so the basemap switcher (top-right) stays reachable; it never
 * takes clicks, so it can't block the map either.
 */
export function LiveBadge({ overview }: { overview: AlertsOverview | null }) {
  const alerts = areaAlerts(overview).sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]).slice(0, 3);
  const readings = (overview?.sources.traffic.readings ?? []).filter((r) => r.usable);
  const flow = overview?.sources.glofas?.forecast;
  if (alerts.length === 0 && readings.length === 0 && !flow) return null;
  return (
    <div aria-label="Live conditions" className="pointer-events-none absolute left-16 top-11 z-[1000] max-w-xs rounded-md border border-slate-200 bg-white/95 p-2 text-[11px] shadow-sm">
      <p className="mb-1 flex items-center gap-1 font-semibold uppercase tracking-wide text-red-700">
        <Radio size={12} aria-hidden /> Live
      </p>
      <ul className="space-y-0.5 text-slate-700">
        {alerts.map((a) => (
          <li key={a.id}>
            <span className={SEVERITY_RANK[a.severity] >= SEVERITY_RANK.severe ? "font-semibold text-red-700" : "font-semibold text-amber-700"}>
              {a.isDemo ? "DEMO " : ""}{a.severity}
            </span>{" "}
            {a.title.replace(/^DEMO · /, "")}
          </li>
        ))}
        {flow && (
          <li className="text-slate-600">
            {flow.river} flow (GloFAS model): {Math.round(flow.todayM3s)} m³/s, likely peak {Math.round(flow.peakM3s)} (2-year flood {flow.thresholdsM3s.warning})
          </li>
        )}
        {readings.map((r) => (
          <li key={r.sectionId} className="text-slate-600">
            Traffic, {r.name}: {r.currentSpeed} km/h (usually {r.freeFlowSpeed})
          </li>
        ))}
      </ul>
    </div>
  );
}
