"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import type { MapSelection } from "@/components/map/layers/types";
import {
  compareRuns, fetchScenario, fetchScenarios, generateAlternativePlan, type LiveAlert, runSimulation,
} from "@/lib/api/client";
import { applyOverrides } from "@/lib/scenario/overrides";
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

  /** Re-list scenarios (one was just imported) and open the given one. */
  const openScenario = useCallback(async (scenarioId: string) => {
    try {
      dispatch({ type: "scenariosLoaded", scenarios: await fetchScenarios() });
      await loadScenario(scenarioId);
    } catch (error) {
      dispatch({ type: "failed", message: message(error) });
    }
  }, [loadScenario]);

  /**
   * Bring an alert's conditions into the Scenario Lab: open its scenario if it
   * names one, then add its road closures or reduced capacities. Nothing runs
   * until the planner presses Run or Optimize.
   */
  const applyAlert = useCallback(async (alert: LiveAlert) => {
    const action = alert.action;
    if (!action) return;
    if (action.scenarioId && action.scenarioId !== stateRef.current.scenario?.id) await loadScenario(action.scenarioId);
    dispatch({
      type: "applyAlert",
      alert: { id: alert.id, title: alert.title, isDemo: alert.isDemo, appliedAt: new Date().toISOString() },
      conditions: { closedEdgeIds: action.closedEdgeIds, edgeCapacityFactors: action.edgeCapacityFactors },
    });
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
        ? await compareRuns(plan.baselineRun, plan.alternativeRun, request.scenario.defaultParams.tickSeconds)
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
    openScenario,
    run,
    generatePlan,
    toggleEdge: (edgeId: string) => dispatch({ type: "toggleEdge", edgeId }),
    toggleShelter: (shelterId: string) => dispatch({ type: "toggleShelter", shelterId }),
    setEdgeCapacity: (edgeId: string, factor: number | null) => dispatch({ type: "setEdgeCapacity", edgeId, factor }),
    applyAlert,
    clearOverrides: () => dispatch({ type: "clearOverrides" }),
    setSeed: (seed: number) => dispatch({ type: "setSeed", seed }),
    select: (selection: MapSelection) => dispatch({ type: "select", selection }),
    reset: () => dispatch({ type: "reset" }),
  }), [loadScenario, openScenario, run, generatePlan, applyAlert]);

  /** The scenario as currently edited — what the map draws and the next run will simulate. */
  const effectiveScenario = useMemo(
    () => (state.scenario ? applyOverrides(state.scenario, state.overrides) : null),
    [state.scenario, state.overrides],
  );

  return { state, actions, effectiveScenario };
}

export type AegisActions = ReturnType<typeof useAegis>["actions"];
