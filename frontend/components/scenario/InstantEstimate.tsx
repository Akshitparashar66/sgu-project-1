"use client";

import { Gauge, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Card } from "@/components/ui/Card";
import { type OutcomeEstimate, predictOutcome } from "@/lib/api/client";
import type { ScenarioConfig } from "@/lib/schemas/types";
import { type AegisState, isRunStale } from "@/lib/state/aegisReducer";

const DEBOUNCE_MS = 250;

/**
 * Updates as roads and shelters are toggled, before anything is run. The
 * numbers come from a model trained on simulation runs; the Run button gives
 * the real ones, shown alongside once they exist for the same setup.
 */
export function InstantEstimate({ state, scenario }: { state: AegisState; scenario: ScenarioConfig }) {
  const [estimate, setEstimate] = useState<OutcomeEstimate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scenarioId = state.scenario?.id;
  const { closedEdgeIds, unavailableShelterIds } = state.overrides;

  useEffect(() => {
    if (!scenarioId) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const result = await predictOutcome({ scenarioId, closedEdgeIds, unavailableShelterIds }, controller.signal);
        setEstimate(result);
        setError(null);
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [scenarioId, closedEdgeIds, unavailableShelterIds]);

  const { tickSeconds, maxTicks } = scenario.defaultParams;
  const run = state.run && !isRunStale(state) ? state.run : null;
  const actual = run && {
    clearance: run.metrics.completionTick === null ? null : (run.metrics.completionTick * tickSeconds) / 60,
    unserved: run.metrics.unservedCount,
    peak: run.metrics.maxCongestionRatio,
  };
  const limitMinutes = (maxTicks * tickSeconds) / 60;

  return (
    <Card title="Instant estimate" actions={loading ? <Loader2 size={14} className="animate-spin text-slate-400" aria-label="Updating estimate" /> : null}>
      {error && <p role="alert" className="text-sm text-red-700">Estimate unavailable: {error}</p>}
      {estimate && !estimate.available && <p className="text-sm text-slate-500">{estimate.reason}</p>}
      {estimate?.available && (
        <>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat
              label="Clearance time"
              value={estimate.clearanceAtTimeLimit ? `${limitMinutes}+ min` : `${Math.round(estimate.clearanceMinutes)} min`}
              error={`±${Math.round(estimate.model.testMetrics.clearanceMinutes.labP90AbsError)} min`}
              actual={actual ? (actual.clearance === null ? `${limitMinutes}+ min (time limit)` : `${Number(actual.clearance.toFixed(1))} min`) : null}
            />
            <Stat
              label="Unserved"
              value={`${estimate.unservedCount.toLocaleString()} of ${estimate.evacuees.toLocaleString()}`}
              error={`±${Math.round(estimate.model.testMetrics.unservedShare.labP90AbsError)}`}
              actual={actual ? actual.unserved.toLocaleString() : null}
            />
            <Stat
              label="Peak congestion"
              value={`${estimate.peakCongestion.toFixed(2)}×`}
              error={`±${estimate.model.testMetrics.peakCongestion.labP90AbsError.toFixed(2)}`}
              actual={actual ? `${actual.peak.toFixed(2)}×` : null}
            />
          </dl>
          <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-500">
            <Gauge size={13} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              Machine-learning estimate ({estimate.model.method}, trained on {estimate.model.samples.toLocaleString()} simulated
              what-ifs). Ranges cover 90% of held-out test cases. It learns this simulator, not real evacuations.
              {actual ? " Simulation results are for your last run of this exact setup." : " Run the simulation for the real numbers."}
            </span>
          </p>
        </>
      )}
    </Card>
  );
}

function Stat({ label, value, error, actual }: { label: string; value: string; error: string; actual: string | null }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5">
        <span className="font-mono text-lg font-semibold tabular-nums text-slate-900">~{value}</span>{" "}
        <span className="text-xs text-slate-500">{error}</span>
        {actual !== null && <span className="mt-1 block text-xs text-slate-600">Simulation: <span className="tabular-nums">{actual}</span></span>}
      </dd>
    </div>
  );
}
