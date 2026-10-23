import { describe, expect, it } from "vitest";
import type { RunResult, ScenarioConfig } from "@/lib/schemas/types";
import { aegisReducer, initialAegisState, isRunStale, runKey } from "./aegisReducer";

const scenario = {
  id: "scenario_a_normal", name: "Normal", defaultParams: { tickSeconds: 30, maxTicks: 240, randomSeed: 42 },
} as unknown as ScenarioConfig;
const run = { runId: "r1", randomSeed: 42 } as RunResult;

function loaded() {
  return aegisReducer(initialAegisState, { type: "scenarioLoaded", scenario });
}

describe("aegisReducer", () => {
  it("adopts the scenario's default seed when a scenario loads", () => {
    const state = loaded();
    expect(state.scenario).toBe(scenario);
    expect(state.seed).toBe(42);
    expect(state.status).toBe("idle");
  });

  it("records which inputs a run used, so later what-if edits mark it stale", () => {
    let state = aegisReducer(loaded(), { type: "runStarted" });
    expect(state.status).toBe("running");
    state = aegisReducer(state, { type: "runSucceeded", run, key: runKey(state) });
    expect(state.status).toBe("completed");
    expect(isRunStale(state)).toBe(false);

    state = aegisReducer(state, { type: "toggleEdge", edgeId: "E3" });
    expect(state.overrides.closedEdgeIds).toEqual(["E3"]);
    expect(isRunStale(state)).toBe(true);

    state = aegisReducer(state, { type: "toggleEdge", edgeId: "E3" });
    expect(isRunStale(state)).toBe(false); // back to exactly what was simulated
  });

  it("treats a seed change as a different experiment", () => {
    let state = aegisReducer(loaded(), { type: "runSucceeded", run, key: runKey(loaded()) });
    state = aegisReducer(state, { type: "setSeed", seed: 7 });
    expect(isRunStale(state)).toBe(true);
  });

  it("Reset restores the pre-run state without touching the loaded scenario (PRD §5.1)", () => {
    let state = aegisReducer(loaded(), { type: "toggleShelter", shelterId: "S1" });
    state = aegisReducer(state, { type: "runSucceeded", run, key: runKey(state) });
    state = aegisReducer(state, { type: "select", selection: { kind: "edge", id: "E1" } });

    state = aegisReducer(state, { type: "reset" });

    expect(state.run).toBeNull();
    expect(state.plan).toBeNull();
    expect(state.comparison).toBeNull();
    expect(state.selection).toBeNull();
    expect(state.overrides).toEqual({ closedEdgeIds: [], unavailableShelterIds: [] });
    expect(state.status).toBe("idle");
    expect(state.scenario).toBe(scenario);
  });

  it("adopts a plan's baseline as the current run — it is the same simulation /run would return for these inputs", () => {
    const baselineRun = { runId: "b1", randomSeed: 42 } as RunResult;
    const state = aegisReducer(loaded(), {
      type: "planSucceeded",
      plan: { feasible: false, baselineRun, changes: [], tradeOffs: [] },
      comparison: null,
      key: runKey(loaded()),
    });

    expect(state.run).toBe(baselineRun);
    expect(isRunStale(state)).toBe(false);
  });

  it("surfaces failures as an error status with the backend's message", () => {
    const state = aegisReducer(loaded(), { type: "failed", message: "Unknown scenario_id 'x'" });
    expect(state.status).toBe("error");
    expect(state.error).toBe("Unknown scenario_id 'x'");
  });
});
