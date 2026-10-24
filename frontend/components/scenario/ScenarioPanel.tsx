"use client";

import { GitCompareArrows, Loader2, Play, X } from "lucide-react";

import { FindingsList } from "@/components/insights/FindingsList";
import { RiverLevel } from "@/components/river/RiverLevel";
import { buildRecommendations } from "@/lib/insights/recommendations";
import { hasOverrides } from "@/lib/scenario/overrides";
import type { ScenarioConfig } from "@/lib/schemas/types";
import { type AegisState, isRunStale } from "@/lib/state/aegisReducer";
import type { AegisActions } from "@/lib/state/useAegis";

interface ScenarioPanelProps {
  state: AegisState;
  effectiveScenario: ScenarioConfig;
  actions: AegisActions;
  onOpenComparison: () => void;
}

export function ScenarioPanel({ state, effectiveScenario, actions, onOpenComparison }: ScenarioPanelProps) {
  const scenario = effectiveScenario;
  const stale = isRunStale(state);
  const evacuees = scenario.zones.reduce((sum, z) => sum + z.evacueeCount, 0);
  const capacity = scenario.shelters.filter((s) => s.available).reduce((sum, s) => sum + s.totalCapacity, 0);
  const closedRoads = scenario.edges.filter((e) => e.status === "closed").length;
  const { closedEdgeIds, unavailableShelterIds } = state.overrides;

  return (
    <aside aria-label="Scenario controls" className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-r border-slate-200 bg-slate-50 p-4">
      <section>
        <label htmlFor="scenario-select" className="text-xs uppercase tracking-wide text-slate-500">Scenario</label>
        <select
          id="scenario-select"
          value={state.scenario?.id ?? ""}
          onChange={(e) => actions.loadScenario(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600"
        >
          {state.scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">{state.scenario?.description}</p>
      </section>

      <dl className="grid grid-cols-3 gap-2 text-center">
        <Fact label="Evacuees" value={evacuees} />
        <Fact label="Shelter places" value={capacity} warn={capacity < evacuees} />
        <Fact label="Roads closed" value={`${closedRoads}/${scenario.edges.length}`} warn={closedRoads > 0} />
      </dl>

      <section>
        <h2 className="text-xs uppercase tracking-wide text-slate-500">What-if changes</h2>
        {hasOverrides(state.overrides) ? (
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {closedEdgeIds.map((id) => (
              <OverrideChip key={id} label={`Road ${id} closed`} onRemove={() => actions.toggleEdge(id)} />
            ))}
            {unavailableShelterIds.map((id) => (
              <OverrideChip key={id} label={`Shelter ${id} unavailable`} onRemove={() => actions.toggleShelter(id)} />
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-slate-500">Click a road or shelter on the map to close it, or use the Scenario Lab.</p>
        )}
      </section>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={actions.run}
          disabled={!state.scenario || state.busy !== null}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state.busy === "run" ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Play size={16} aria-hidden />}
          Run simulation
        </button>
        <button
          type="button"
          onClick={async () => { await actions.generatePlan(); onOpenComparison(); }}
          disabled={!state.scenario || state.busy !== null}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-blue-200 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state.busy === "plan" ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <GitCompareArrows size={16} aria-hidden />}
          Optimize plan
        </button>
      </div>

      {state.error && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">{state.error}</p>
      )}

      {stale && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          Results below are from before your latest changes. Run the simulation again to update them.
        </p>
      )}

      {state.run && !stale && state.scenario && (
        <section>
          <h2 className="mb-2 text-xs uppercase tracking-wide text-slate-500">Findings</h2>
          <FindingsList recommendations={buildRecommendations(scenario, state.run)} />
        </section>
      )}
      <RiverLevel actions={actions} />
    </aside>
  );
}

function Fact({ label, value, warn = false }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-1 py-2">
      <dd className={`font-mono text-lg font-semibold tabular-nums ${warn ? "text-amber-700" : "text-slate-900"}`}>{value}</dd>
      <dt className="text-[11px] text-slate-500">{label}</dt>
    </div>
  );
}

function OverrideChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <li className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 py-0.5 pl-2.5 pr-1 text-xs text-red-700">
      {label}
      <button type="button" onClick={onRemove} aria-label={`Undo: ${label}`} className="rounded-full p-0.5 hover:bg-red-100">
        <X size={12} aria-hidden />
      </button>
    </li>
  );
}
