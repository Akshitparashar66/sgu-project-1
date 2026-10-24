"use client";

import { ExternalLink } from "lucide-react";
import { useState } from "react";

import { applicability, SOURCE_LABEL, timeAgo } from "@/lib/alerts/alerts";
import type { LiveAlert } from "@/lib/api/client";
import type { ScenarioConfig } from "@/lib/schemas/types";
import { AcknowledgeForm } from "./AcknowledgeForm";
import { SendPanel } from "./SendPanel";
import { DemoTag, SeverityTag } from "./SeverityTag";

const time = (iso: string) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

interface AlertCardProps {
  alert: LiveAlert;
  scenario: ScenarioConfig | null;
  applied: boolean;
  onApply: (alert: LiveAlert) => void;
  onChanged: () => void;
}

export function AlertCard({ alert, scenario, applied, onApply, onChanged }: AlertCardProps) {
  const [open, setOpen] = useState<"ack" | "send" | null>(null);
  const apply = applicability(alert, scenario);
  const expired = alert.status === "expired";
  const sent = alert.deliveries.filter((d) => d.status === "sent").length;
  const failed = alert.deliveries.length - sent;

  return (
    <li className={`rounded-lg border bg-white p-4 ${expired ? "border-slate-200 opacity-70" : "border-slate-300"}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <SeverityTag severity={alert.severity} />
        {alert.isDemo && <DemoTag />}
        <span>{SOURCE_LABEL[alert.source]}</span>
        <span>· raised {timeAgo(alert.raisedAt)}</span>
        {alert.expiresAt && !expired && <span>· until {time(alert.expiresAt)}</span>}
        <span className="ml-auto font-medium text-slate-700">
          {expired ? `Ended: ${alert.clearedReason ?? "expired"}` : alert.status === "acknowledged" ? "Acknowledged" : "Open"}
        </span>
      </div>
      <h3 className="mt-2 font-medium text-slate-900">{alert.title}</h3>
      {alert.titleHi && <p lang="hi" className="mt-0.5 text-sm text-slate-600">{alert.titleHi}</p>}
      {alert.detail && <p className="mt-1.5 text-sm text-slate-600">{alert.detail}</p>}
      <p className="mt-1.5 text-xs text-slate-500">
        {alert.area && <>Area: {alert.area} · </>}Observed {time(alert.observedAt)}
        {alert.link && (
          <a href={alert.link} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-0.5 text-blue-700 hover:underline">
            Original <ExternalLink size={11} aria-hidden />
          </a>
        )}
      </p>
      {alert.acknowledgement && (
        <p className="mt-1.5 text-xs text-slate-600">
          Acknowledged by {alert.acknowledgement.by} at {time(alert.acknowledgement.at)}
          {alert.acknowledgement.note && `: “${alert.acknowledgement.note}”`}
        </p>
      )}
      {alert.deliveries.length > 0 && (
        <p className="mt-1 text-xs text-slate-600">
          Messages: {sent} sent{failed > 0 && <span className="text-red-700">, {failed} failed</span>}
        </p>
      )}

      {!expired && (
        <div className="mt-3 flex flex-wrap gap-2">
          {alert.action && (
            <button
              type="button"
              disabled={!apply.ok || applied}
              title={apply.reason}
              onClick={() => onApply(alert)}
              className="rounded-md bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {applied ? "Applied in the Scenario Lab" : `Apply: ${alert.action.label}`}
            </button>
          )}
          {alert.status === "active" && (
            <button type="button" onClick={() => setOpen(open === "ack" ? null : "ack")} className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100">
              Acknowledge
            </button>
          )}
          <button type="button" onClick={() => setOpen(open === "send" ? null : "send")} className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-100">
            Send to phones
          </button>
        </div>
      )}
      {!apply.ok && alert.action && !expired && <p className="mt-1 text-xs text-slate-500">{apply.reason}.</p>}
      {open === "ack" && <div className="mt-3"><AcknowledgeForm alertId={alert.id} onDone={() => { setOpen(null); onChanged(); }} /></div>}
      {open === "send" && <div className="mt-3"><SendPanel alertId={alert.id} onSent={onChanged} /></div>}
    </li>
  );
}
