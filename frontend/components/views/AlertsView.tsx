"use client";

import { Loader2, Play, Square } from "lucide-react";
import { useEffect, useState } from "react";

import { AlertCard } from "@/components/alerts/AlertCard";
import { AutoSendSettings } from "@/components/alerts/AutoSendSettings";
import { Recipients } from "@/components/alerts/Recipients";
import { SourcesStrip } from "@/components/alerts/SourcesStrip";
import { Card, Page } from "@/components/ui/Card";
import { useAlerts } from "@/lib/alerts/AlertsContext";
import { type AlertLogEvent, fetchAlertLog, type LiveAlert, startDemo, stopDemo } from "@/lib/api/client";
import type { ScenarioConfig } from "@/lib/schemas/types";

const FILTERS = {
  open: { label: "Open", keep: (a: LiveAlert) => a.status !== "expired" },
  acknowledged: { label: "Acknowledged", keep: (a: LiveAlert) => a.status === "acknowledged" },
  expired: { label: "Ended", keep: (a: LiveAlert) => a.status === "expired" },
  all: { label: "All", keep: () => true },
} as const;

interface AlertsViewProps {
  scenario: ScenarioConfig | null;
  appliedIds?: string[];
  onApply: (alert: LiveAlert) => void;
}

export function AlertsView({ scenario, appliedIds = [], onApply }: AlertsViewProps) {
  const { overview, unreachableSince, refresh, setOverview } = useAlerts();
  const [filter, setFilter] = useState<keyof typeof FILTERS>("open");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<AlertLogEvent[]>([]);

  useEffect(() => {
    fetchAlertLog().then(setLog).catch(() => setLog([]));
  }, [overview]);

  async function toggleDemo() {
    if (!overview) return;
    setBusy(true);
    try {
      setOverview(await (overview.demo.running ? stopDemo() : startDemo()));
    } finally {
      setBusy(false);
    }
  }

  if (!overview) {
    return (
      <Page title="Alerts">
        <p className="text-sm text-slate-500">{unreachableSince ? "Cannot reach the AEGIS backend for live data." : "Loading live data…"}</p>
      </Page>
    );
  }
  const shown = overview.alerts.filter(FILTERS[filter].keep);

  return (
    <Page
      title="Alerts"
      intro="Official warnings, river levels and road traffic, checked continuously. Apply brings an alert's conditions into the Scenario Lab; nothing changes a plan until you run it."
      actions={
        <button
          type="button"
          onClick={toggleDemo}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-md border border-violet-300 px-3 py-2 text-sm font-medium text-violet-800 hover:bg-violet-50 disabled:opacity-50"
        >
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : overview.demo.running ? <Square size={15} aria-hidden /> : <Play size={15} aria-hidden />}
          {overview.demo.running ? "Stop flood-day demo" : "Start flood-day demo"}
        </button>
      }
    >
      <SourcesStrip overview={overview} />

      <section aria-label="Alert list" className="space-y-3">
        <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
          {(Object.keys(FILTERS) as (keyof typeof FILTERS)[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className={`rounded-full px-3 py-1 text-xs ${filter === key ? "bg-slate-900 text-white" : "border border-slate-300 text-slate-700 hover:bg-slate-100"}`}
            >
              {FILTERS[key].label} ({overview.alerts.filter(FILTERS[key].keep).length})
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            {filter === "open" ? "No open alerts. Sources are being checked; start the flood-day demo to rehearse." : "Nothing here."}
          </p>
        ) : (
          <ul className="space-y-3">
            {shown.map((alert) => (
              <AlertCard key={alert.id} alert={alert} scenario={scenario} applied={appliedIds.includes(alert.id)}
                onApply={onApply} onChanged={() => void refresh()} />
            ))}
          </ul>
        )}
      </section>

      <Recipients />
      <AutoSendSettings key={JSON.stringify(overview.settings)} settings={overview.settings} onSaved={() => void refresh()} />

      <Card title="Log">
        {log.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing logged yet.</p>
        ) : (
          <ol className="max-h-64 space-y-1 overflow-y-auto text-xs text-slate-600">
            {log.slice(0, 50).map((e, i) => (
              <li key={`${e.at}-${i}`}>
                <span className="tabular-nums text-slate-500">{new Date(e.at).toLocaleString()}</span> · {e.event}
                {e.alertId && <> · {e.alertId}</>}
                {e.by && <> · by {e.by}</>}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </Page>
  );
}
