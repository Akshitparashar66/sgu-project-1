"use client";

import { CloudOff, Siren } from "lucide-react";
import { useState } from "react";

import { applicability, bannerAlert, openAlertCount, SOURCE_LABEL, timeAgo } from "@/lib/alerts/alerts";
import { useAlerts } from "@/lib/alerts/AlertsContext";
import type { LiveAlert } from "@/lib/api/client";
import type { ScenarioConfig } from "@/lib/schemas/types";
import { AcknowledgeForm } from "./AcknowledgeForm";
import { DemoTag, SeverityTag } from "./SeverityTag";

interface AlertBannerProps {
  scenario: ScenarioConfig | null;
  /** Alerts whose conditions are already in the what-ifs. */
  appliedIds?: string[];
  onApply: (alert: LiveAlert) => void;
  onOpenAlerts: () => void;
}

/** The most serious open alert, across the top of every page. */
export function AlertBanner({ scenario, appliedIds = [], onApply, onOpenAlerts }: AlertBannerProps) {
  const { overview, unreachableSince, refresh } = useAlerts();
  const [acknowledging, setAcknowledging] = useState<string | null>(null);

  if (unreachableSince) {
    return (
      <div role="status" className="flex items-center gap-2 border-b border-slate-300 bg-slate-100 px-4 py-1.5 text-sm text-slate-700 xl:px-6">
        <CloudOff size={15} aria-hidden />
        Live data unavailable since {unreachableSince.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}: alerts may be out of date.
      </div>
    );
  }
  const alert = overview ? bannerAlert(overview.alerts) : null;
  if (!alert || !overview) return null;

  const serious = alert.severity === "severe" || alert.severity === "extreme";
  const others = openAlertCount(overview.alerts);
  const apply = applicability(alert, scenario);
  const applied = appliedIds.includes(alert.id);
  const button = serious
    ? "border-white/60 text-white hover:bg-white/15"
    : "border-amber-700/40 text-amber-950 hover:bg-amber-200";

  return (
    <div
      role="alert"
      aria-label={`${alert.severity} alert`}
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2 text-sm xl:px-6 ${
        serious ? "border-red-800 bg-red-700 text-white" : "border-amber-300 bg-amber-100 text-amber-950"
      }`}
    >
      <Siren size={16} aria-hidden className="shrink-0" />
      <SeverityTag severity={alert.severity} />
      {alert.isDemo && <DemoTag />}
      <span className="min-w-0 flex-1 font-medium">
        {alert.title}
        <span className={`ml-2 font-normal ${serious ? "text-red-100" : "text-amber-800"}`}>
          {SOURCE_LABEL[alert.source]} · {timeAgo(alert.raisedAt)}
        </span>
      </span>
      {acknowledging === alert.id ? (
        <div className="rounded-md bg-white/95 px-2 py-1">
          <AcknowledgeForm alertId={alert.id} compact onDone={() => { setAcknowledging(null); void refresh(); }} />
        </div>
      ) : (
        <span className="flex flex-wrap gap-2">
          {alert.action && (
            <button
              type="button"
              disabled={!apply.ok || applied}
              title={apply.reason}
              onClick={() => onApply(alert)}
              className={`rounded-md border px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${button}`}
            >
              {applied ? "Applied in the Scenario Lab" : `Apply: ${alert.action.label}`}
            </button>
          )}
          <button type="button" onClick={() => setAcknowledging(alert.id)} className={`rounded-md border px-2.5 py-1 text-xs ${button}`}>
            Acknowledge
          </button>
          <button type="button" onClick={onOpenAlerts} className={`rounded-md border px-2.5 py-1 text-xs ${button}`}>
            All alerts ({others})
          </button>
        </span>
      )}
    </div>
  );
}
