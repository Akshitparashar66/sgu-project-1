"use client";

import { CircleCheck, Hourglass, Pause, Play, RotateCcw, Route, TriangleAlert, UserX } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { ArrivalsChart } from "@/components/charts/ArrivalsChart";
import { ShelterMeters } from "@/components/live/ShelterMeters";
import { ReplayMapView } from "@/components/map/MapView";
import { agentMarkerColor } from "@/lib/map/styling";
import { formatCompletionTick } from "@/lib/metrics/format";
import { arrivalsSeries, buildReplay, countsAt, occupancyAt, scenarioAt } from "@/lib/replay/replay";
import { PLAYBACK_SPEEDS, usePlayback } from "@/lib/replay/usePlayback";
import type { RunResult, ScenarioConfig } from "@/lib/schemas/types";
import { applyInterventions } from "@/lib/scenario/interventions";
import { type AegisState, isPlanStale, isRunStale } from "@/lib/state/aegisReducer";
import type { AegisActions } from "@/lib/state/useAegis";

interface LiveSimulationViewProps {
  state: AegisState;
  effectiveScenario: ScenarioConfig;
  actions: AegisActions;
}

export function LiveSimulationView({ state, effectiveScenario, actions }: LiveSimulationViewProps) {
  if (!state.run) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-sm text-center">
          <p className="text-sm text-slate-500">The replay animates every evacuee from a completed run, tick by tick.</p>
          <button
            type="button"
            onClick={actions.run}
            disabled={state.busy !== null}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Play size={16} aria-hidden /> Run simulation
          </button>
        </div>
      </div>
    );
  }
  return <LiveReplay state={state} run={state.run} scenario={effectiveScenario} />;
}

/** Replays the current run, or the optimized plan when one exists for the current setup. */
function LiveReplay({ state, run: baseline, scenario }: { state: AegisState; run: RunResult; scenario: ScenarioConfig }) {
  const optimized = state.plan?.feasible && !isPlanStale(state) ? state.plan.alternativeRun ?? null : null;
  const [showOptimized, setShowOptimized] = useState(false);
  const run = showOptimized && optimized ? optimized : baseline;
  const picker = optimized && (
    <div role="group" aria-label="Plan to replay" className="flex rounded-md border border-slate-200 text-xs">
      {([["Baseline", false], ["Optimized plan", true]] as const).map(([label, value]) => (
        <button
          key={label}
          type="button"
          aria-pressed={showOptimized === value}
          onClick={() => setShowOptimized(value)}
          className={`px-2.5 py-1.5 ${showOptimized === value ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-100"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
  // Keyed on the run so switching plans or a new run starts a fresh replay at tick 0.
  // The optimized plan may open standby shelters and post marshals: replay it on the scenario it changed.
  const replayScenario = run === baseline ? scenario : applyInterventions(scenario, state.plan?.interventions);
  return <LivePlayer key={run.runId} run={run} scenario={replayScenario} stale={run === baseline && isRunStale(state)} picker={picker || null} />;
}

function LivePlayer({ run, scenario, stale, picker }: { run: RunResult; scenario: ScenarioConfig; stale: boolean; picker: ReactNode }) {
  const replay = useMemo(() => buildReplay(scenario, run), [scenario, run]);
  const { tickSeconds } = scenario.defaultParams;
  const { t, playing, speed, setSpeed, seek, toggle } = usePlayback(replay.lastTick);
  const tick = Math.floor(t);

  // Everything except the moving dots changes once per whole tick, not per frame.
  const counts = useMemo(() => countsAt(replay, tick), [replay, tick]);
  // Roads that flood during the run turn to "closed" on the map as the replay reaches them.
  const scenarioNow = useMemo(() => scenarioAt(scenario, tick), [scenario, tick]);
  const occupancy = useMemo(() => occupancyAt(replay, tick), [replay, tick]);
  const series = useMemo(
    () => [{ id: "arrived", label: "In shelter", color: agentMarkerColor("arrived"), points: arrivalsSeries(run, tickSeconds, replay.lastTick) }],
    [run, tickSeconds, replay.lastTick],
  );
  const total = run.agents.length;
  const staged = useMemo(() => run.agents.some((a) => (a.departureTick ?? 0) > 0), [run.agents]);
  const congestion = useMemo(
    () => Object.fromEntries(run.congestion.map((c) => [c.edgeId, c.peakDemandToCapacity])),
    [run.congestion],
  );

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        {stale && (
          <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
            Replaying the last run, which predates your latest scenario changes. Run again from Overview to replay the current setup.
          </p>
        )}
        <div className="relative min-h-0 flex-1">
          <ReplayMapView scenario={scenarioNow} congestionByEdgeId={congestion} occupancyByShelterId={occupancy} replay={replay} t={t} />
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 bg-white px-4 py-3">
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? "Pause replay" : "Play replay"}
            className="grid h-9 w-9 place-items-center rounded-full bg-blue-600 text-white hover:bg-blue-700"
          >
            {playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
          </button>
          <button
            type="button"
            onClick={() => seek(0)}
            aria-label="Rewind to start"
            className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 text-slate-700 hover:bg-slate-100"
          >
            <RotateCcw size={15} aria-hidden />
          </button>
          <input
            type="range"
            min={0}
            max={replay.lastTick}
            step={0.25}
            value={t}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Simulation time"
            aria-valuetext={`Tick ${tick}, ${formatCompletionTick(tick, false, tickSeconds)}`}
            className="min-w-40 flex-1 accent-blue-600"
          />
          {picker}
          <span className="whitespace-nowrap text-right text-sm tabular-nums text-slate-700">
            T+{formatCompletionTick(tick, false, tickSeconds)} <span className="text-slate-500">· tick {tick}/{replay.lastTick}</span>
          </span>
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            Speed
            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value) as (typeof PLAYBACK_SPEEDS)[number])}
              className="rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-800"
            >
              {PLAYBACK_SPEEDS.map((s) => <option key={s} value={s}>{s} ticks/s</option>)}
            </select>
          </label>
        </div>
      </div>

      <aside aria-label="Replay statistics" className="w-80 shrink-0 space-y-5 overflow-y-auto border-l border-slate-200 bg-slate-50 p-4">
        <dl className="grid grid-cols-2 gap-2">
          <Count icon={CircleCheck} label="In shelter" value={counts.arrived} color={agentMarkerColor("arrived")} />
          <Count icon={Route} label="Moving" value={counts.moving} color={agentMarkerColor("moving")} />
          <Count icon={TriangleAlert} label="Delayed in congestion" value={counts.delayed} color={agentMarkerColor("delayed")} />
          <Count icon={UserX} label="Unserved" value={counts.unserved} color={agentMarkerColor("unserved")} />
          {staged && <Count icon={Hourglass} label="Waiting for their wave" value={counts.waiting} color={agentMarkerColor("waiting")} />}
        </dl>
        <section>
          <h2 className="mb-2 text-xs uppercase tracking-wide text-slate-500">Shelters</h2>
          <ShelterMeters shelters={scenario.shelters} occupancy={occupancy} />
        </section>
        <section>
          <h2 className="mb-2 text-xs uppercase tracking-wide text-slate-500">Evacuees in shelter over time</h2>
          <ArrivalsChart series={series} total={total} cursorMinute={(tick * tickSeconds) / 60} height={170} />
        </section>
      </aside>
    </div>
  );
}

function Count({ icon: Icon, label, value, color }: { icon: typeof Route; label: string; value: number; color: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-2.5">
      <dt className="flex items-center gap-1.5 text-[11px] text-slate-500">
        <Icon size={13} aria-hidden style={{ color }} />
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-xl font-semibold tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}
