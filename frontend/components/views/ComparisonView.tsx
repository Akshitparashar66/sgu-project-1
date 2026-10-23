"use client";

import { CircleCheck, GitCompareArrows, Loader2, TriangleAlert } from "lucide-react";

import { BriefingCard } from "@/components/ai/BriefingCard";
import { ArrivalsChart } from "@/components/charts/ArrivalsChart";
import { ComparisonTable } from "@/components/comparison/ComparisonTable";
import { Card, Page, rowClass, tableClass, theadClass } from "@/components/ui/Card";
import { formatOccupancy } from "@/lib/metrics/format";
import { summarizeReassignments } from "@/lib/metrics/reassignments";
import { verdictSummary } from "@/lib/metrics/verdict";
import { arrivalsSeries } from "@/lib/replay/replay";
import type { ScenarioConfig } from "@/lib/schemas/types";
import { type AegisState, isPlanStale } from "@/lib/state/aegisReducer";
import type { AegisActions } from "@/lib/state/useAegis";

// Emphasis form: the alternative is the accent, the baseline is context gray.
// Validated on the slate-900 surface (scripts/validate_palette.js): CVD ΔE 24.1, normal-vision ΔE 26.6.
const BASELINE_COLOR = "#64748b";
const ALTERNATIVE_COLOR = "#2563eb";

export function ComparisonView({ state, effectiveScenario, actions }: {
  state: AegisState; effectiveScenario: ScenarioConfig; actions: AegisActions;
}) {
  const { plan, comparison } = state;
  const stale = isPlanStale(state);
  const { tickSeconds } = effectiveScenario.defaultParams;
  const verdict = comparison ? verdictSummary(comparison) : null;

  return (
    <Page
      title="Plan comparison"
      intro={
        <>
          <strong className="font-medium text-slate-700">Baseline</strong>: every evacuee goes to the nearest reachable shelter with space.{" "}
          <strong className="font-medium text-slate-700">Alternative</strong>: each picks the least-loaded of its 2 nearest shelters.
          Both run through the same simulation engine with the same seed. This is a documented heuristic, not a trained model.
        </>
      }
      actions={
        <button
          type="button"
          onClick={actions.generatePlan}
          disabled={!state.scenario || state.busy !== null}
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state.busy === "plan" ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <GitCompareArrows size={16} aria-hidden />}
          {plan ? "Regenerate" : "Generate alternative plan"}
        </button>
      }
    >
      {state.error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}

      {!plan && (
        <p className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
          No alternative plan yet. Generate one to compare it against the baseline for the current scenario and what-if changes.
        </p>
      )}

      {plan && stale && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          This comparison was computed before your latest scenario changes. Regenerate to compare the current setup.
        </p>
      )}

      {plan && (
        <div className={`flex items-start gap-3 rounded-lg border p-4 ${plan.feasible ? "border-green-200 bg-green-50/60" : "border-amber-200 bg-amber-50/60"}`}>
          {plan.feasible
            ? <CircleCheck className="mt-0.5 shrink-0 text-green-700" size={20} aria-hidden />
            : <TriangleAlert className="mt-0.5 shrink-0 text-amber-700" size={20} aria-hidden />}
          <div>
            <h2 className={`font-semibold ${plan.feasible ? "text-green-800" : "text-amber-800"}`}>
              {plan.feasible ? "Improvement found" : "No feasible improvement found"}
            </h2>
            {plan.reason && <p className="mt-1 text-sm text-slate-700">{plan.reason}</p>}
            {plan.feasible && verdict && (
              <p className="mt-1 text-sm text-slate-700">
                Better on {verdict.improved.join(", ") || "no metric"}
                {verdict.worse.length > 0 ? `; trade-off: worse on ${verdict.worse.join(", ")}` : "; no plan metric got worse"}.
              </p>
            )}
            {plan.tradeOffs.length > 0 && (
              <ul className="mt-2 list-inside list-disc space-y-0.5 text-sm text-slate-700">
                {plan.tradeOffs.map((t) => <li key={t}>{t}</li>)}
              </ul>
            )}
          </div>
        </div>
      )}

      {plan?.alternativeRun && !stale && <BriefingCard state={state} includePlan />}

      {comparison && (
        <Card title="Metric by metric">
          <ComparisonTable comparison={comparison} />
        </Card>
      )}

      {plan?.baselineRun && plan.alternativeRun && (
        <>
          <Card title="Evacuees in shelter over time">
            <ArrivalsChart
              total={plan.baselineRun.agents.length}
              series={[
                { id: "baseline", label: "Baseline", color: BASELINE_COLOR, points: arrivalsSeries(plan.baselineRun, tickSeconds) },
                { id: "alternative", label: "Alternative", color: ALTERNATIVE_COLOR, points: arrivalsSeries(plan.alternativeRun, tickSeconds) },
              ]}
              height={240}
            />
          </Card>

          <Card title="Shelter occupancy">
            <table className={tableClass}>
              <thead className={theadClass}>
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
                    <tr key={base.shelterId} className={rowClass}>
                      <th scope="row" className="py-2 font-normal text-slate-800">{base.shelterId}</th>
                      <td className="py-2 text-right tabular-nums text-slate-700">{formatOccupancy(base.finalOccupied, base.totalCapacity)}</td>
                      <td className="py-2 text-right tabular-nums text-slate-900">{alt ? formatOccupancy(alt.finalOccupied, alt.totalCapacity) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {plan?.feasible && plan.changes.length > 0 && (
        <Card title={`Reassignments (${plan.changes.length} evacuees)`}>
          <ul className="space-y-1 text-sm text-slate-700">
            {summarizeReassignments(plan.changes).map((g) => (
              <li key={`${g.originZone}-${g.from}-${g.to}`}>
                <span className="tabular-nums text-slate-900">{g.count}</span> from zone {g.originZone}: {g.from} → {g.to}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </Page>
  );
}
