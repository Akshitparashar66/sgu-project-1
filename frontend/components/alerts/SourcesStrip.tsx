import { FlowLine } from "@/components/river/FlowForecast";
import { timeAgo } from "@/lib/alerts/alerts";
import type { AlertsOverview, LiveSource } from "@/lib/api/client";

const STATE_STYLE: Record<LiveSource["state"], string> = {
  connected: "bg-green-50 text-green-700",
  running: "bg-violet-50 text-violet-700",
  waiting: "bg-slate-100 text-slate-600",
  stopped: "bg-slate-100 text-slate-600",
  off: "bg-slate-100 text-slate-600",
  "not configured": "bg-amber-50 text-amber-800",
  unavailable: "bg-red-50 text-red-700",
};

function SourceTile({ source, children }: { source: LiveSource; children?: React.ReactNode }) {
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-800">{source.label}</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATE_STYLE[source.state]}`}>{source.state}</span>
      </div>
      {source.lastCheckAt && (
        <p className="mt-1 text-xs text-slate-500">
          Checked {timeAgo(source.lastCheckAt)}
          {source.lastSuccessAt && source.lastSuccessAt !== source.lastCheckAt && ` · last good ${timeAgo(source.lastSuccessAt)}`}
        </p>
      )}
      {source.reason && <p className="mt-1 text-xs text-slate-500">{source.reason}</p>}
      {source.lastError && <p className="mt-1 break-words text-xs text-red-700">{source.lastError}</p>}
      {children}
    </li>
  );
}

/** Where live data comes from and whether each source is working. */
export function SourcesStrip({ overview }: { overview: AlertsOverview }) {
  const { sources, traffic } = overview;
  return (
    <ul aria-label="Live sources" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <SourceTile source={sources.ndma} />
      <SourceTile source={sources.river} />
      <SourceTile source={sources.glofas}>
        {sources.glofas.forecast && <FlowLine forecast={sources.glofas.forecast} />}
      </SourceTile>
      <SourceTile source={sources.traffic}>
        {sources.traffic.readings?.map((r) => (
          <p key={r.sectionId} className="mt-1 text-xs text-slate-600">
            {r.name} ({r.edgeIds.join(", ")}): {r.currentSpeed} km/h, usually {r.freeFlowSpeed}
            {!r.usable && " · not used (low confidence)"}
          </p>
        ))}
        <p className="mt-1 text-xs text-slate-500">No data for {traffic.notCovered.edgeIds.join(", ")}: {traffic.notCovered.reason}</p>
      </SourceTile>
      <SourceTile source={sources.demo}>
        <p className="mt-1 text-xs text-slate-500">A scripted flood day for rehearsals. Its alerts say DEMO and are never sent automatically.</p>
      </SourceTile>
    </ul>
  );
}
