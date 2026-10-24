"use client";

import { CircleCheck, GitCompareArrows, Loader2, Printer, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { ArrivalsChart } from "@/components/charts/ArrivalsChart";
import { PrintOrdersDialog } from "@/components/orders/PrintableOrders";
import { SavePlanForm } from "@/components/plans/SavedPlans";
import { ComparisonTable } from "@/components/comparison/ComparisonTable";
import { Card, Page, rowClass, tableClass, theadClass } from "@/components/ui/Card";
import { formatOccupancy } from "@/lib/metrics/format";
import { summarizeReassignments } from "@/lib/metrics/reassignments";
import { verdictSummary } from "@/lib/metrics/verdict";
import { arrivalsSeries } from "@/lib/replay/replay";
import type { EvacuationOrder, Percentiles, PlanRobustness } from "@/lib/api/client";
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
  const [printing, setPrinting] = useState(false);
  const clearance = plan?.alternativeRun?.metrics.completionTick != null
    ? (plan.alternativeRun.metrics.completionTick * tickSeconds) / 60
    : null;

  return (
    <Page
      title="Plan comparison"
      intro={
        <>
          <strong className="font-medium text-slate-700">Baseline</strong>: everyone leaves at once for the nearest reachable shelter with space.{" "}
          <strong className="font-medium text-slate-700">Optimized plan</strong>: a search (simulated annealing) over which shelter each group goes to,
          by which road, and when it leaves, scored by the simulation itself. The plan it finds is re-run on the same engine with the same seed.
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
          {plan ? "Re-optimize" : "Optimize plan"}
        </button>
      }
    >
      {state.error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}

      {!plan && (
        <p className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
          No optimized plan yet. Press Optimize plan to search for a better one and compare it against the baseline for the current scenario and what-if changes.
        </p>
      )}

      {plan && stale && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          This comparison was computed before your latest scenario changes. Re-optimize to compare the current setup.
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

      {plan?.feasible && plan.interventions && (plan.interventions.openedShelters.length > 0 || plan.interventions.marshalledRoads.length > 0) && (
        <Card title="What the plan changes on the ground">
          <ul className="list-inside list-disc space-y-1 text-sm text-slate-700">
            {plan.interventions.openedShelters.map((s) => {
              const shelter = effectiveScenario.shelters.find((x) => x.id === s.shelterId);
              const opens = ((shelter?.opensAtTick ?? 0) * effectiveScenario.defaultParams.tickSeconds) / 60;
              return (
                <li key={s.shelterId}>
                  Open the standby shelter <strong>{s.name}</strong> ({shelter?.totalCapacity.toLocaleString()} places{opens ? `, ready ${opens} min after the order` : ""}).
                </li>
              );
            })}
            {plan.interventions.marshalledRoads.map((id) => (
              <li key={id}>Post a marshal team on road <strong>{id}</strong> to keep the crowd moving (25% more people per minute onto it).</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">
            The optimizer only uses these when they pay for themselves: each costs the equivalent of 30 s (marshals) or 1.5 min
            (opening a shelter) of clearance time in its score.
          </p>
        </Card>
      )}

      {plan?.robustness && <Robustness robustness={plan.robustness} />}

      {plan?.feasible && plan.orders && plan.orders.length > 0 && (
        <>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setPrinting(true)}
              disabled={stale}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-40"
            >
              <Printer size={15} aria-hidden /> Print orders (English / हिन्दी)
            </button>
          </div>
          <EvacuationOrders orders={plan.orders} scenario={effectiveScenario} />
          {!stale && <SavePlanForm state={state} />}
        </>
      )}
      {printing && plan?.orders && (
        <PrintOrdersDialog
          orders={plan.orders}
          interventions={plan.interventions}
          scenario={effectiveScenario}
          clearanceMinutes={clearance}
          onClose={() => setPrinting(false)}
        />
      )}

      {plan?.search && (
        <p className="text-xs text-slate-500">
          The optimizer evaluated {plan.search.plansEvaluated.toLocaleString()} candidate plans
          ({plan.search.iterations.toLocaleString()} {plan.search.method} steps, groups of up to {plan.search.blockSize} people)
          in {(plan.search.runtimeMs / 1000).toFixed(1)} s.
          {plan.search.clearanceLowerBoundMinutes !== null && plan.alternativeRun?.metrics.completionTick != null && (
            <>
              {" "}No plan can clear in under {plan.search.clearanceLowerBoundMinutes} min (a lower bound from walking times and road
              capacity); this one takes {(plan.alternativeRun.metrics.completionTick * effectiveScenario.defaultParams.tickSeconds) / 60} min.
            </>
          )}
        </p>
      )}

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
                  <th scope="col" className="py-2 text-right font-medium">Optimized</th>
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

/** The optimized plan as orders a coordinator could read out, wave by wave. */
export function EvacuationOrders({ orders, scenario }: { orders: EvacuationOrder[]; scenario: ScenarioConfig }) {
  const zoneName = (id: string) => scenario.zones.find((z) => z.id === id)?.name ?? id;
  const shelterName = (id: string) => scenario.shelters.find((s) => s.id === id)?.name ?? id;
  const nodeLabel = (id: string) => scenario.nodes.find((n) => n.id === id)?.label ?? id;
  const via = (order: EvacuationOrder) => {
    // Walk the route from the zone so each step names the junction reached.
    let at = scenario.zones.find((z) => z.id === order.zoneId)?.connectorNode;
    return order.routeEdgeIds.map((edgeId) => {
      const edge = scenario.edges.find((e) => e.id === edgeId);
      if (!edge || !at) return edgeId;
      at = edge.source === at ? edge.target : edge.source;
      return `${edgeId} to ${nodeLabel(at)}`;
    }).join("; ");
  };
  const waves = [...new Set(orders.map((o) => o.departureMinute))].sort((a, b) => a - b);
  const waveLabel = (minute: number) => (minute === 0 ? "Now" : `+${minute} min`);

  return (
    <Card title="Evacuation orders">
      <div className="space-y-2">
        {waves.map((minute, w) => {
          const wave = orders.filter((o) => o.departureMinute === minute);
          const byZone = new Map<string, number>();
          for (const o of wave) byZone.set(o.zoneId, (byZone.get(o.zoneId) ?? 0) + o.people);
          const people = wave.reduce((n, o) => n + o.people, 0);
          return (
            <details key={minute} open={w === 0} className="rounded-md border border-slate-200">
              <summary className="cursor-pointer select-none px-3 py-2 text-sm">
                <span className="font-semibold tabular-nums text-slate-900">{waveLabel(minute)}</span>
                <span className="text-slate-600"> · {people.toLocaleString()} people · </span>
                <span className="text-slate-500">{[...byZone].map(([zone, n]) => `${zoneName(zone)} ${n}`).join(", ")}</span>
              </summary>
              <table className={`${tableClass} border-t border-slate-200`}>
                <caption className="sr-only">Leaving {waveLabel(minute)}</caption>
                <thead className={theadClass}>
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">From</th>
                    <th scope="col" className="py-2 text-right font-medium">People</th>
                    <th scope="col" className="py-2 pl-4 font-medium">To shelter</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Route</th>
                  </tr>
                </thead>
                <tbody>
                  {wave.map((o) => (
                    <tr key={`${o.zoneId}-${o.movementProfile}-${o.shelterId}-${o.routeEdgeIds.join()}`} className={rowClass}>
                      <th scope="row" className="px-3 py-2 align-top font-normal text-slate-700">
                        {zoneName(o.zoneId)}
                        {o.movementProfile !== "standard" && <span className="text-slate-500"> · {o.movementProfile.replace(/_/g, " ")}</span>}
                      </th>
                      <td className="py-2 text-right align-top tabular-nums text-slate-900">{o.people}</td>
                      <td className="py-2 pl-4 align-top text-slate-700">{shelterName(o.shelterId)}</td>
                      <td className="py-2 pr-3 align-top text-xs text-slate-500" title={via(o)}>{o.routeEdgeIds.join(" → ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          );
        })}
      </div>
    </Card>
  );
}

function range({ p10, p50, p90 }: Percentiles, unit = "") {
  return p10 === p90 ? `${p50}${unit}` : `${p10}–${p90}${unit} (typically ${p50})`;
}

/** The comparison under realistic variation, not just the one nominal run. */
export function Robustness({ robustness: r }: { robustness: PlanRobustness }) {
  const rows: [string, (s: PlanRobustness["baseline"]) => string][] = [
    ["Clearance time", (s) => range(s.clearanceMinutes, " min")],
    ["Unserved", (s) => range(s.unserved)],
    ["Average time to shelter", (s) => range(s.averageMinutes, " min")],
  ];
  return (
    <Card title="How robust is it?">
      <p className="mb-3 text-sm text-slate-700">
        Across {r.variations} variations ({r.assumptions.join("; ")}), the optimized plan did better than the baseline in{" "}
        <strong className="tabular-nums">{r.optimizedBetter} of {r.variations}</strong>.
      </p>
      <table className={tableClass}>
        <caption className="sr-only">10th to 90th percentile outcomes under variation</caption>
        <thead className={theadClass}>
          <tr>
            <th scope="col" className="py-2 font-medium">Metric (10th–90th percentile)</th>
            <th scope="col" className="py-2 text-right font-medium">Baseline</th>
            <th scope="col" className="py-2 text-right font-medium">Optimized</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className={rowClass}>
              <th scope="row" className="py-2 font-normal text-slate-800">{label}</th>
              <td className="py-2 text-right tabular-nums text-slate-700">{value(r.baseline)}</td>
              <td className="py-2 text-right tabular-nums text-slate-900">{value(r.optimized)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(r.baseline.hitTimeLimit > 0 || r.optimized.hitTimeLimit > 0) && (
        <p className="mt-2 text-xs text-amber-700">
          Ran out of time in {r.baseline.hitTimeLimit} of {r.variations} variations (baseline) and{" "}
          {r.optimized.hitTimeLimit} of {r.variations} (optimized); those count the time limit as their clearance time.
        </p>
      )}
    </Card>
  );
}
