"use client";

import { Download, Printer } from "lucide-react";

import { BriefingCard } from "@/components/ai/BriefingCard";
import { FindingsList } from "@/components/insights/FindingsList";
import { Card, Page, rowClass, tableClass, theadClass } from "@/components/ui/Card";
import { buildRecommendations } from "@/lib/insights/recommendations";
import { formatCompletionTick, formatOccupancy } from "@/lib/metrics/format";
import { roadReport, zoneOutcomes } from "@/lib/reports/report";
import { hasOverrides } from "@/lib/scenario/overrides";
import type { ScenarioConfig } from "@/lib/schemas/types";
import { type AegisState, isRunStale } from "@/lib/state/aegisReducer";

const MAX_WARNINGS_SHOWN = 25;

export function ReportsView({ state, effectiveScenario: scenario }: { state: AegisState; effectiveScenario: ScenarioConfig }) {
  const run = state.run;
  if (!run) {
    return (
      <Page title="Run report" intro="A detailed, exportable record of the last simulation run.">
        <p className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
          No run yet. Run a simulation from Overview or the Scenario Lab, then come back for the full report.
        </p>
      </Page>
    );
  }

  const stale = isRunStale(state);
  const { tickSeconds } = scenario.defaultParams;
  const changes = [
    ...state.overrides.closedEdgeIds.map((id) => `road ${id} closed`),
    ...state.overrides.unavailableShelterIds.map((id) => `shelter ${id} unavailable`),
  ];

  function exportJson() {
    const payload = {
      generatedBy: "AEGIS prototype — synthetic data, not live emergency guidance",
      scenario, overrides: state.overrides, run,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `aegis-run-${scenario.id}-seed${run!.randomSeed}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Page
      title="Run report"
      intro={
        <>
          <strong className="font-medium text-slate-700">{scenario.name}</strong> · seed {run.randomSeed} ·{" "}
          {hasOverrides(state.overrides) ? `what-if: ${changes.join(", ")}` : "no what-if changes"} · run {run.runId.slice(0, 8)}
        </>
      }
      actions={
        <>
          <button type="button" onClick={exportJson} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
            <Download size={15} aria-hidden /> Export JSON
          </button>
          <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
            <Printer size={15} aria-hidden /> Print
          </button>
        </>
      }
    >
      {stale && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          This report describes the last run, which predates your latest scenario changes.
        </p>
      )}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Evacuated" value={run.metrics.evacuatedCount} />
        <Kpi label="Unserved" value={run.metrics.unservedCount} />
        <Kpi label="Completion" value={formatCompletionTick(run.metrics.completionTick, run.metrics.hitTickLimit, tickSeconds)} />
        <Kpi label="Peak congestion" value={`${run.metrics.maxCongestionRatio.toFixed(2)}×`} />
      </dl>

      {!stale && <BriefingCard state={state} />}

      {!stale && (
        <Card title="Findings">
          <FindingsList recommendations={buildRecommendations(scenario, run)} />
        </Card>
      )}

      <Card title="Outcome by population zone">
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th scope="col" className="py-2 font-medium">Zone</th>
              <th scope="col" className="py-2 text-right font-medium">Evacuees</th>
              <th scope="col" className="py-2 text-right font-medium">Reached shelter</th>
              <th scope="col" className="py-2 text-right font-medium">Unserved</th>
              <th scope="col" className="py-2 text-right font-medium">Mean time to shelter</th>
            </tr>
          </thead>
          <tbody>
            {zoneOutcomes(scenario, run).map((z) => (
              <tr key={z.zoneId} className={rowClass}>
                <th scope="row" className="py-2 font-normal text-slate-800">{z.zoneId} · {z.name}</th>
                <td className="py-2 text-right tabular-nums text-slate-700">{z.evacuees}</td>
                <td className="py-2 text-right tabular-nums text-slate-700">{z.arrived}</td>
                <td className={`py-2 text-right tabular-nums ${z.unserved > 0 ? "text-red-600" : "text-slate-700"}`}>{z.unserved}</td>
                <td className="py-2 text-right tabular-nums text-slate-700">
                  {z.meanArrivalMinutes === null ? "—" : `${z.meanArrivalMinutes.toFixed(1)} min`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Shelters">
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th scope="col" className="py-2 font-medium">Shelter</th>
              <th scope="col" className="py-2 text-right font-medium">Final occupancy</th>
              <th scope="col" className="py-2 text-right font-medium">Turned away</th>
            </tr>
          </thead>
          <tbody>
            {run.shelters.map((s) => (
              <tr key={s.shelterId} className={rowClass}>
                <th scope="row" className="py-2 font-normal text-slate-800">
                  {s.shelterId} · {scenario.shelters.find((x) => x.id === s.shelterId)?.name}
                </th>
                <td className="py-2 text-right tabular-nums text-slate-700">{formatOccupancy(s.finalOccupied, s.totalCapacity)}</td>
                <td className={`py-2 text-right tabular-nums ${s.rejectedCount > 0 ? "text-amber-700" : "text-slate-700"}`}>{s.rejectedCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Roads used, worst congestion first">
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th scope="col" className="py-2 font-medium">Road</th>
              <th scope="col" className="py-2 font-medium">Between</th>
              <th scope="col" className="py-2 text-right font-medium">Evacuees routed</th>
              <th scope="col" className="py-2 text-right font-medium">Peak demand / capacity</th>
              <th scope="col" className="py-2 text-right font-medium">Congestion delay</th>
            </tr>
          </thead>
          <tbody>
            {roadReport(scenario, run).map((r) => (
              <tr key={r.edgeId} className={rowClass}>
                <th scope="row" className="py-2 font-normal text-slate-800">{r.edgeId}</th>
                <td className="py-2 text-slate-500">{r.from} → {r.to}</td>
                <td className="py-2 text-right tabular-nums text-slate-700">{r.routed}</td>
                <td className={`py-2 text-right tabular-nums ${r.peakRatio > 1.5 ? "text-red-600" : r.peakRatio > 1 ? "text-amber-700" : "text-slate-700"}`}>
                  {r.peakRatio.toFixed(2)}× <span className="text-slate-500">@ tick {r.peakTick}</span>
                </td>
                <td className="py-2 text-right tabular-nums text-slate-700">{r.delayHours.toFixed(1)} agent-h</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {run.warnings.length > 0 && (
        <Card title={`Engine warnings (${run.warnings.length})`}>
          <ul className="space-y-1 text-xs text-amber-800">
            {run.warnings.slice(0, MAX_WARNINGS_SHOWN).map((w, i) => <li key={i}>{w}</li>)}
          </ul>
          {run.warnings.length > MAX_WARNINGS_SHOWN && (
            <p className="mt-2 text-xs text-slate-500">…and {run.warnings.length - MAX_WARNINGS_SHOWN} more in the JSON export.</p>
          )}
        </Card>
      )}

      <p className="text-xs text-slate-500">
        Synthetic data and simplified movement rules — a planning prototype, not live emergency guidance. Modeling assumptions are listed in
        docs/ASSUMPTIONS.md.
      </p>
    </Page>
  );
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-mono text-2xl font-semibold tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}
