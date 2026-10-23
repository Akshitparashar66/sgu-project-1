"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import type { MapSelection } from "@/components/map/layers/types";
import { compareRuns, fetchScenario, fetchScenarios, generateAlternativePlan, runSimulation } from "@/lib/api/client";
import { applyOverrides, type OverrideChanges } from "@/lib/scenario/overrides";
import { aegisReducer, type AegisState, initialAegisState, runKey } from "./aegisReducer";

const DEFAULT_SCENARIO_ID = "scenario_a_normal";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useAegis() {
  const [state, dispatch] = useReducer(aegisReducer, initialAegisState);
  const stateRef = useRef<AegisState>(state);
  // Bumped whenever the scenario changes; a response that comes back for an
  // older generation is dropped instead of overwriting the new scenario.
  const generation = useRef(0);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const loadScenario = useCallback(async (scenarioId: string) => {
    const myGeneration = ++generation.current;
    try {
      const scenario = await fetchScenario(scenarioId);
      if (myGeneration === generation.current) dispatch({ type: "scenarioLoaded", scenario });
    } catch (error) {
      if (myGeneration === generation.current) dispatch({ type: "failed", message: message(error) });
    }
  }, []);

  useEffect(() => {
    fetchScenarios()
      .then((scenarios) => {
        dispatch({ type: "scenariosLoaded", scenarios });
        const initial = scenarios.find((s) => s.id === DEFAULT_SCENARIO_ID) ?? scenarios[0];
        if (initial) return loadScenario(initial.id);
      })
      .catch((error) => dispatch({ type: "failed", message: message(error) }));
  }, [loadScenario]);

  const runRequest = () => {
    const { scenario, overrides, seed } = stateRef.current;
    if (!scenario) return null;
    return { scenario, overrides, seed, key: runKey(stateRef.current), myGeneration: generation.current };
  };

  const run = useCallback(async () => {
    const request = runRequest();
    if (!request) return;
    dispatch({ type: "runStarted" });
    try {
      const result = await runSimulation({
        scenarioId: request.scenario.id,
        params: { ...request.scenario.defaultParams, randomSeed: request.seed },
        ...request.overrides,
      });
      if (request.myGeneration === generation.current) dispatch({ type: "runSucceeded", run: result, key: request.key });
    } catch (error) {
      if (request.myGeneration === generation.current) dispatch({ type: "failed", message: message(error) });
    }
  }, []);

  const generatePlan = useCallback(async () => {
    const request = runRequest();
    if (!request) return;
    dispatch({ type: "planStarted" });
    try {
      const plan = await generateAlternativePlan({
        scenarioId: request.scenario.id, randomSeed: request.seed, ...request.overrides,
      });
      // Even an infeasible verdict carries both runs, so the evidence is comparable.
      const comparison = plan.baselineRun && plan.alternativeRun
        ? await compareRuns(plan.baselineRun, plan.alternativeRun)
        : null;
      if (request.myGeneration === generation.current) {
        dispatch({ type: "planSucceeded", plan, comparison, key: request.key });
      }
    } catch (error) {
      if (request.myGeneration === generation.current) dispatch({ type: "failed", message: message(error) });
    }
  }, []);

  const actions = useMemo(() => ({
    loadScenario,
    run,
    generatePlan,
    toggleEdge: (edgeId: string) => dispatch({ type: "toggleEdge", edgeId }),
    toggleShelter: (shelterId: string) => dispatch({ type: "toggleShelter", shelterId }),
    clearOverrides: () => dispatch({ type: "clearOverrides" }),
    applyChanges: (changes: OverrideChanges) => dispatch({ type: "applyChanges", changes }),
    setSeed: (seed: number) => dispatch({ type: "setSeed", seed }),
    select: (selection: MapSelection) => dispatch({ type: "select", selection }),
    reset: () => dispatch({ type: "reset" }),
  }), [loadScenario, run, generatePlan]);

  /** The scenario as currently edited — what the map draws and the next run will simulate. */
  const effectiveScenario = useMemo(
    () => (state.scenario ? applyOverrides(state.scenario, state.overrides) : null),
    [state.scenario, state.overrides],
  );

  return { state, actions, effectiveScenario };
}

export type AegisActions = ReturnType<typeof useAegis>["actions"];
