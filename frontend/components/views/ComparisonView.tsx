"use client";

import { CircleCheck, GitCompareArrows, Loader2, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { ComparisonTable } from "@/components/comparison/ComparisonTable";
import { formatOccupancy } from "@/lib/metrics/format";
import { summarizeReassignments } from "@/lib/metrics/reassignments";
import { type AegisState, isPlanStale } from "@/lib/state/aegisReducer";
import type { AegisActions } from "@/lib/state/useAegis";

export function ComparisonView({ state, actions }: { state: AegisState; actions: AegisActions }) {
  const { plan, comparison } = state;
  const stale = isPlanStale(state);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-100">Plan comparison</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              <strong className="font-medium text-slate-300">Baseline</strong>: every evacuee goes to the nearest reachable shelter with space.{" "}
              <strong className="font-medium text-slate-300">Alternative</strong>: each picks the least-loaded of its 2 nearest shelters.
              Both run through the same simulation engine with the same seed. This is a documented heuristic, not a trained model.
            </p>
          </div>
          <button
            type="button"
            onClick={actions.generatePlan}
            disabled={!state.scenario || state.busy !== null}
            className="inline-flex items-center gap-2 rounded-md bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {state.busy === "plan" ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <GitCompareArrows size={16} aria-hidden />}
            {plan ? "Regenerate" : "Generate alternative plan"}
          </button>
        </header>

        {state.error && <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{state.error}</p>}

        {!plan && (
          <p className="rounded-lg border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">
            No alternative plan yet. Generate one to compare it against the baseline for the current scenario and what-if changes.
          </p>
        )}

        {plan && stale && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-300">
            This comparison was computed before your latest scenario changes. Regenerate to compare the current setup.
          </p>
        )}

        {plan && (
          <div
            className={`flex items-start gap-3 rounded-lg border p-4 ${plan.feasible ? "border-green-500/40 bg-green-500/5" : "border-amber-500/40 bg-amber-500/5"}`}
          >
            {plan.feasible
              ? <CircleCheck className="mt-0.5 shrink-0 text-green-400" size={20} aria-hidden />
              : <TriangleAlert className="mt-0.5 shrink-0 text-amber-400" size={20} aria-hidden />}
            <div>
              <h2 className={`font-semibold ${plan.feasible ? "text-green-300" : "text-amber-300"}`}>
                {plan.feasible ? "The alternative plan improves on the baseline" : "No feasible improvement found"}
              </h2>
              {plan.reason && <p className="mt-1 text-sm text-slate-300">{plan.reason}</p>}
              {plan.tradeOffs.length > 0 && (
                <ul className="mt-2 list-inside list-disc space-y-0.5 text-sm text-slate-300">
                  {plan.tradeOffs.map((t) => <li key={t}>{t}</li>)}
                </ul>
              )}
            </div>
          </div>
        )}

        {comparison && (
          <Card title="Metric by metric">
            <ComparisonTable comparison={comparison} />
          </Card>
        )}

        {plan?.baselineRun && plan.alternativeRun && (
          <Card title="Shelter occupancy">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="py-2 font-medium">Shelter</th>
                  <th scope="col" className="py-2 text-right font-medium">Baseline</th>
                  <th scope="col" className="py-2 text-right font-medium">Alternative</th>
                </tr>
              </thead>
              <tbody>
                {plan.baselineRun.shelters.map((base) => {
                  const alt = plan.alternativeRun!.shelters.find((s) => s.shelterId === base.shelterId);
                  return (
                    <tr key={base.shelterId} className="border-t border-slate-800">
                      <th scope="row" className="py-2 font-normal text-slate-200">{base.shelterId}</th>
                      <td className="py-2 text-right tabular-nums text-slate-300">{formatOccupancy(base.finalOccupied, base.totalCapacity)}</td>
                      <td className="py-2 text-right tabular-nums text-slate-100">{alt ? formatOccupancy(alt.finalOccupied, alt.totalCapacity) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}

        {plan?.feasible && plan.changes.length > 0 && (
          <Card title={`Reassignments (${plan.changes.length} evacuees)`}>
            <ul className="space-y-1 text-sm text-slate-300">
              {summarizeReassignments(plan.changes).map((g) => (
                <li key={`${g.originZone}-${g.from}-${g.to}`}>
                  <span className="tabular-nums text-slate-100">{g.count}</span> from zone {g.originZone}: {g.from} → {g.to}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
      <h2 className="mb-3 text-xs uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </section>
  );
}
