import { describe, expect, it } from "vitest";
import type { AgentResult, RunResult, ScenarioConfig } from "@/lib/schemas/types";
import { arrivalsSeries, buildReplay, countsAt, framesAt, occupancyAt, scenarioAt } from "./replay";

// N1 (zone) --E1--> N2 <--E2-- N3 (shelter). E2 is stored N3->N2 but walked N2->N3.
const scenario: ScenarioConfig = {
  id: "s", name: "s", description: "", synthetic: true,
  nodes: [{ id: "N1", lat: 0, lon: 0 }, { id: "N2", lat: 0, lon: 1 }, { id: "N3", lat: 0, lon: 2 }],
  edges: [
    { id: "E1", source: "N1", target: "N2", lengthM: 100, capacityPerTick: 10, baseTravelTimeS: 60, status: "open", hazardRisk: 0 },
    { id: "E2", source: "N3", target: "N2", lengthM: 100, capacityPerTick: 10, baseTravelTimeS: 60, status: "open", hazardRisk: 0 },
  ],
  zones: [{ id: "Z1", name: "Z", connectorNode: "N1", evacueeCount: 3, movementProfile: { standard: 1 } }],
  shelters: [{ id: "S1", name: "S", connectorNode: "N3", totalCapacity: 10, occupied: 0, available: true }],
  hazards: [],
  defaultParams: { tickSeconds: 30, maxTicks: 20, randomSeed: 42 },
};

function agent(fields: Partial<AgentResult>): AgentResult {
  return {
    id: "A", originZone: "Z1", assignedShelter: "S1", routeEdgeIds: ["E1", "E2"], status: "arrived",
    movementProfile: "standard", edgeEntryTicks: [], edgeExitTicks: [], ...fields,
  };
}

function run(agents: AgentResult[], hitTickLimit = false): RunResult {
  return {
    runId: "r", scenarioId: "s", planLabel: "baseline", randomSeed: 42,
    metrics: { evacuatedCount: 0, unservedCount: 0, completionTick: null, hitTickLimit, maxCongestionRatio: 0, runtimeMs: 0 },
    agents, shelters: [], congestion: [], warnings: [],
  };
}

// Free-flow: 60s / 30s = 2 ticks per edge. E1 ticks 0-1, E2 ticks 2-3, arrives at tick 3.
const onTime = agent({ id: "on-time", edgeEntryTicks: [0, 2], edgeExitTicks: [1, 3], arrivalTick: 3 });
// Congested on E1: 4 ticks instead of 2.
const jammed = agent({ id: "jammed", edgeEntryTicks: [0, 4], edgeExitTicks: [3, 5], arrivalTick: 5 });
const unassigned = agent({ id: "unassigned", assignedShelter: undefined, routeEdgeIds: [], status: "unserved" });

function frame(replay: ReturnType<typeof buildReplay>, t: number, id: string) {
  return framesAt(replay, t, { jitter: false }).find((f) => f.id === id)!;
}

describe("replay", () => {
  it("shows someone waiting outside a shelter that hasn't let them in yet as delayed, at the shelter", () => {
    const atDoor = agent({ id: "door", edgeEntryTicks: [0, 2], edgeExitTicks: [1, 3], arrivalTick: 9 });
    const replay = buildReplay(scenario, run([atDoor]));

    expect(frame(replay, 6, "door")).toMatchObject({ lon: 2, status: "delayed" });
    expect(frame(replay, 9, "door").status).toBe("arrived");
  });

  it("draws a road as closed from the tick it floods", () => {
    const flooding = { ...scenario, edges: scenario.edges.map((e) => (e.id === "E1" ? { ...e, closesAtTick: 5 } : e)) };
    expect(scenarioAt(flooding, 4).edges[0].status).toBe("open");
    expect(scenarioAt(flooding, 5).edges[0].status).toBe("closed");
  });

  it("shows people in line for a road as delayed where they wait, not as unserved", () => {
    // Leaves at tick 0 but E1 lets them in only at tick 2; E2 only at tick 6 after leaving E1 at tick 3.
    const queued = agent({ id: "queued", edgeEntryTicks: [2, 6], edgeExitTicks: [3, 7], arrivalTick: 7 });
    const replay = buildReplay(scenario, run([queued]));

    expect(frame(replay, 1, "queued")).toMatchObject({ lon: 0, status: "delayed" }); // at the zone
    expect(frame(replay, 5, "queued")).toMatchObject({ lon: 1, status: "delayed" }); // at the junction
    expect(frame(replay, 7, "queued").status).toBe("arrived");
  });

  it("counts someone still in line when time runs out as unserved", () => {
    const stuck = agent({ id: "stuck", status: "unserved", edgeEntryTicks: [], edgeExitTicks: [] });
    const replay = buildReplay(scenario, run([stuck], true));

    expect(frame(replay, 3, "stuck").status).toBe("delayed");
    expect(frame(replay, 20, "stuck").status).toBe("unserved");
  });

  it("holds a staged evacuee at its zone as waiting until its wave leaves", () => {
    const staged = agent({ id: "staged", departureTick: 10, edgeEntryTicks: [10, 12], edgeExitTicks: [11, 13], arrivalTick: 13 });
    const replay = buildReplay(scenario, run([staged]));

    expect(frame(replay, 5, "staged")).toMatchObject({ lat: 0, lon: 0, status: "waiting" });
    expect(countsAt(replay, 5).waiting).toBe(1);
    expect(frame(replay, 10, "staged").status).toBe("moving");
  });

  it("moves an agent along its edges in walking order, even over a reversed edge", () => {
    const replay = buildReplay(scenario, run([onTime]));

    expect(frame(replay, 0, "on-time")).toMatchObject({ lon: 0.5, status: "moving" }); // half of E1 after tick 0
    expect(frame(replay, 1, "on-time")).toMatchObject({ lon: 1 });                     // end of E1 = N2
    expect(frame(replay, 2, "on-time").lon).toBeCloseTo(1.5);                          // E2 walked N2 -> N3
    expect(frame(replay, 3, "on-time")).toMatchObject({ lon: 2, status: "arrived" });
  });

  it("follows a road's street geometry, reversed when the road is walked target to source", () => {
    // E2 (stored N3 -> N2) bends north through (1, 1.5); walked N2 -> N3 the bend comes first.
    const curved = {
      ...scenario,
      edges: scenario.edges.map((e) => (e.id === "E2" ? { ...e, geometry: [[0, 2], [1, 1.5], [0, 1]] as [number, number][] } : e)),
    };
    const replay = buildReplay(curved, run([onTime]));

    expect(frame(replay, 2, "on-time").lat).toBeCloseTo(1);   // halfway along E2 = the bend, off the straight line
    expect(frame(replay, 2, "on-time").lon).toBeCloseTo(1.5);
    expect(frame(replay, 3, "on-time")).toMatchObject({ lat: 0, lon: 2 });
  });

  it("marks agents delayed while an edge takes longer than free-flow", () => {
    const replay = buildReplay(scenario, run([jammed]));

    expect(frame(replay, 1, "jammed").status).toBe("delayed");
    expect(frame(replay, 4, "jammed").status).toBe("moving");
  });

  it("keeps unassigned agents unserved at their origin from the start", () => {
    const replay = buildReplay(scenario, run([unassigned]));

    expect(frame(replay, 0, "unassigned")).toMatchObject({ lat: 0, lon: 0, status: "unserved" });
  });

  it("leaves an agent cut off by the tick limit stranded on its edge as unserved", () => {
    const cutOff = agent({ id: "cut", edgeEntryTicks: [0, 2], edgeExitTicks: [1], status: "unserved" });
    const replay = buildReplay(scenario, run([cutOff], true));

    expect(replay.lastTick).toBe(20); // the clock ran to max_ticks
    expect(frame(replay, 2, "cut").status).toBe("moving");   // 1 tick into a 2-tick edge
    expect(frame(replay, 10, "cut").status).toBe("delayed"); // 9 ticks into a 2-tick edge
    expect(frame(replay, 20, "cut").status).toBe("unserved");
    expect(frame(replay, 20, "cut").lon).toBeLessThan(2);    // never shown reaching the shelter
  });

  it("counts states and shelter occupancy at a tick", () => {
    const replay = buildReplay(scenario, run([onTime, jammed, unassigned]));

    expect(countsAt(replay, 3)).toEqual({ waiting: 0, arrived: 1, moving: 0, delayed: 1, unserved: 1 });
    expect(occupancyAt(replay, 3)).toEqual({ S1: 1 });
    expect(occupancyAt(replay, 5)).toEqual({ S1: 2 });
  });

  it("builds a cumulative arrivals series with minutes on the x axis", () => {
    const series = arrivalsSeries(run([onTime, jammed]), 30);

    expect(series.map((p) => p.arrived)).toEqual([0, 0, 0, 1, 1, 2]);
    expect(series[4].minutes).toBe(2);
  });
});
