"use client";

import { Inspector } from "@/components/inspector/Inspector";
import { MapView } from "@/components/map/MapView";
import { ResultsDrawer } from "@/components/metrics/ResultsDrawer";
import { ScenarioPanel } from "@/components/scenario/ScenarioPanel";
import type { RunResult, ScenarioConfig } from "@/lib/schemas/types";
import { type AegisState, isRunStale } from "@/lib/state/aegisReducer";
import type { AegisActions } from "@/lib/state/useAegis";

export function runOverlays(run: RunResult | null) {
  if (!run) return {};
  return {
    congestionByEdgeId: Object.fromEntries(run.congestion.map((c) => [c.edgeId, c.peakDemandToCapacity])),
    occupancyByShelterId: Object.fromEntries(run.shelters.map((s) => [s.shelterId, s.finalOccupied])),
    agents: run.agents,
  };
}

interface OverviewViewProps {
  state: AegisState;
  effectiveScenario: ScenarioConfig;
  actions: AegisActions;
  onOpenComparison: () => void;
}

export function OverviewView({ state, effectiveScenario, actions, onOpenComparison }: OverviewViewProps) {
  // A stale run describes a different road network — don't paint it over this one.
  const visibleRun = isRunStale(state) ? null : state.run;

  return (
    <div className="flex h-full">
      <ScenarioPanel state={state} effectiveScenario={effectiveScenario} actions={actions} onOpenComparison={onOpenComparison} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
          <MapView
            scenario={effectiveScenario}
            {...runOverlays(visibleRun)}
            selection={state.selection}
            onSelect={actions.select}
          />
          <div className="absolute right-4 top-4 z-[1000]">
            <Inspector
              scenario={effectiveScenario}
              selection={state.selection}
              run={visibleRun}
              onToggleEdge={actions.toggleEdge}
              onToggleShelter={actions.toggleShelter}
              onClose={() => actions.select(null)}
            />
          </div>
        </div>
        <ResultsDrawer result={state.run} tickSeconds={effectiveScenario.defaultParams.tickSeconds} />
      </div>
    </div>
  );
}
