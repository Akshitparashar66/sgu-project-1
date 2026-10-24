"use client";

import { BadgeCheck, Loader2, Save, ShieldAlert } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { Card } from "@/components/ui/Card";
import { approvePlan, type AuditEvent, fetchAuditLog, listSavedPlans, savePlan, type SavedPlanSummary } from "@/lib/api/client";
import type { AegisState } from "@/lib/state/aegisReducer";

const inputClass = "min-w-0 rounded-md border border-slate-200 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none";

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

/** Save the optimized plan for the current setup, for review and approval. */
export function SavePlanForm({ state }: { state: AegisState }) {
  const [name, setName] = useState("");
  const [preparedBy, setPreparedBy] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!state.scenario) return;
    setBusy(true);
    setMessage(null);
    try {
      const saved = await savePlan({
        name: name.trim(), preparedBy: preparedBy.trim(), note: note.trim(),
        scenarioId: state.scenario.id, randomSeed: state.seed, ...state.overrides,
      });
      setMessage({ ok: true, text: `Saved "${saved.name}" as version ${saved.version}. Review and approve it under Reports.` });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Save this plan">
      <form onSubmit={submit} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Plan name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={inputClass} placeholder="Monsoon plan, Sihani" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Prepared by
          <input value={preparedBy} onChange={(e) => setPreparedBy(e.target.value)} maxLength={80} className={inputClass} placeholder="Name, designation" />
        </label>
        <button
          type="submit"
          disabled={busy || !name.trim() || !preparedBy.trim()}
          className="inline-flex items-center justify-center gap-1.5 self-end rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Save size={15} aria-hidden />} Save plan
        </button>
        <label className="flex flex-col gap-1 text-xs text-slate-500 sm:col-span-3">
          Note (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={inputClass} />
        </label>
      </form>
      <p className="mt-2 text-xs text-slate-500">
        The server re-computes the plan from these inputs and stores it with a fingerprint, so what gets approved is exactly what was saved.
      </p>
      {message && <p role={message.ok ? "status" : "alert"} className={`mt-2 text-sm ${message.ok ? "text-green-800" : "text-red-700"}`}>{message.text}</p>}
    </Card>
  );
}

/** Saved plans with their approvals, and the audit trail of every save and approval. */
export function SavedPlans() {
  const [plans, setPlans] = useState<SavedPlanSummary[] | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [p, e] = await Promise.all([listSavedPlans(), fetchAuditLog()]);
      setPlans(p);
      setEvents(e);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    // Load once when the card appears; refresh() only sets state after the fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  return (
    <Card title="Saved plans">
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {plans && plans.length === 0 && <p className="text-sm text-slate-500">No saved plans yet. Save one from Plan Comparison.</p>}
      {plans && plans.length > 0 && (
        <ul className="space-y-3">
          {plans.map((p) => <PlanRow key={p.id} plan={p} onChange={refresh} />)}
        </ul>
      )}
      {events.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-slate-700">Audit trail ({events.length} events)</summary>
          <ol className="mt-2 space-y-1 text-xs text-slate-600">
            {events.map((e, i) => (
              <li key={i}>
                <span className="tabular-nums">{when(e.at)}</span> · <strong>{e.event}</strong> · {e.name} v{e.version} · by {e.by}
                {e.note ? ` · "${e.note}"` : ""} · <code className="text-slate-500">{e.contentHash.slice(0, 10)}</code>
              </li>
            ))}
          </ol>
        </details>
      )}
      <p className="mt-3 text-xs text-slate-500">
        Names are as typed: this prototype has no logins, so the trail records who people said they were.
      </p>
    </Card>
  );
}

function PlanRow({ plan, onChange }: { plan: SavedPlanSummary; onChange: () => void }) {
  const [approver, setApprover] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const optimized = plan.summary.optimized;

  async function approve(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await approvePlan(plan.id, { approvedBy: approver.trim() });
      setApprover("");
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-md border border-slate-200 p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span>
          <strong className="text-slate-900">{plan.name}</strong> <span className="text-slate-500">v{plan.version} · {plan.scenarioName}</span>
        </span>
        {plan.approvals.length > 0 ? (
          <span className="inline-flex items-center gap-1 text-green-800"><BadgeCheck size={15} aria-hidden /> Approved by {plan.approvals.at(-1)!.by}</span>
        ) : (
          <span className="text-amber-700">Draft</span>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Saved {when(plan.savedAt)} by {plan.preparedBy}
        {optimized ? ` · ${optimized.unserved} unserved, clears in ${optimized.clearanceMinutes ?? "—"} min` : ""}
        {plan.note ? ` · "${plan.note}"` : ""}
      </p>
      {!plan.intact && (
        <p className="mt-1 inline-flex items-center gap-1 text-xs text-red-700">
          <ShieldAlert size={13} aria-hidden /> Changed after saving: can&apos;t be approved.
        </p>
      )}
      {plan.intact && plan.approvals.length === 0 && (
        <form onSubmit={approve} className="mt-2 flex flex-wrap gap-2">
          <label className="sr-only" htmlFor={`approver-${plan.id}`}>Approved by</label>
          <input id={`approver-${plan.id}`} value={approver} onChange={(e) => setApprover(e.target.value)} maxLength={80}
                 placeholder="Approved by (name, designation)" className={`${inputClass} flex-1`} />
          <button type="submit" disabled={busy || !approver.trim()}
                  className="rounded-md border border-green-200 px-3 py-1.5 text-xs font-medium text-green-800 hover:bg-green-50 disabled:opacity-50">
            Approve
          </button>
        </form>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
    </li>
  );
}
