import { describe, expect, it } from "vitest";
import type { AgentResult, RunResult, ScenarioConfig } from "@/lib/schemas/types";
import { buildRecommendations } from "./recommendations";

function scenario(overrides: Partial<ScenarioConfig> = {}): ScenarioConfig {
  return {
    id: "s", name: "s", description: "", synthetic: true,
    nodes: [
      { id: "N1", lat: 0, lon: 0, label: "Zone junction" },
      { id: "N2", lat: 0, lon: 0, label: "Shelter junction" },
    ],
    edges: [
      { id: "E1", source: "N1", target: "N2", lengthM: 100, capacityPerTick: 10, baseTravelTimeS: 60, status: "open", hazardRisk: 0.2 },
    ],
    zones: [{ id: "Z1", name: "Riverside", connectorNode: "N1", evacueeCount: 10, movementProfile: { standard: 1 } }],
    shelters: [{ id: "S1", name: "School", connectorNode: "N2", totalCapacity: 10, occupied: 0, available: true }],
    hazards: [],
    defaultParams: { tickSeconds: 30, maxTicks: 240, randomSeed: 42 },
    ...overrides,
  };
}

function agents(count: number, fields: Partial<AgentResult>): AgentResult[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `A${i}`, originZone: "Z1", assignedShelter: "S1", routeEdgeIds: ["E1"],
    status: "arrived", arrivalTick: 4, movementProfile: "standard", ...fields,
  }));
}

function run(fields: Partial<RunResult> = {}): RunResult {
  return {
    runId: "r", scenarioId: "s", planLabel: "baseline", randomSeed: 42,
    metrics: { evacuatedCount: 10, unservedCount: 0, completionTick: 4, hitTickLimit: false, maxCongestionRatio: 1, runtimeMs: 1 },
    agents: agents(10, {}),
    shelters: [{ shelterId: "S1", totalCapacity: 10, finalOccupied: 10, rejectedCount: 0 }],
    congestion: [{ edgeId: "E1", peakDemandToCapacity: 1, peakTick: 0, totalDelayS: 0 }],
    warnings: [],
    ...fields,
  };
}

describe("buildRecommendations", () => {
  it("flags a shelter-capacity shortfall with the exact numbers from the scenario", () => {
    const shortScenario = scenario({
      shelters: [{ id: "S1", name: "School", connectorNode: "N2", totalCapacity: 6, occupied: 0, available: true }],
    });
    const result = run({
      agents: [...agents(6, {}), ...agents(4, { status: "unserved", assignedShelter: undefined, routeEdgeIds: [], arrivalTick: undefined })],
      metrics: { evacuatedCount: 6, unservedCount: 4, completionTick: 4, hitTickLimit: false, maxCongestionRatio: 1, runtimeMs: 1 },
    });

    const recs = buildRecommendations(shortScenario, result);

    const shortfall = recs.find((r) => r.id === "capacity-shortfall");
    expect(shortfall?.severity).toBe("critical");
    expect(shortfall?.title).toContain("4");
    expect(shortfall?.detail).toContain("10 evacuees");
    expect(shortfall?.detail).toContain("6 available");
  });

  it("names bottleneck roads above 1.5x capacity with routed headcount and delay", () => {
    const result = run({
      congestion: [{ edgeId: "E1", peakDemandToCapacity: 4.2, peakTick: 3, totalDelayS: 7200 }],
      metrics: { evacuatedCount: 10, unservedCount: 0, completionTick: 30, hitTickLimit: false, maxCongestionRatio: 4.2, runtimeMs: 1 },
    });

    const bottleneck = buildRecommendations(scenario(), result).find((r) => r.id === "bottleneck-E1");

    expect(bottleneck?.title).toContain("4.2×");
    expect(bottleneck?.detail).toContain("10 evacuees");
    expect(bottleneck?.detail).toContain("2.0 agent-hours");
    expect(bottleneck?.detail).toContain("Zone junction → Shelter junction");
  });

  it("reports agents stranded by the tick limit as critical", () => {
    const result = run({
      metrics: { evacuatedCount: 7, unservedCount: 3, completionTick: null, hitTickLimit: true, maxCongestionRatio: 1, runtimeMs: 1 },
      warnings: ["Agent A1 did not resolve within max_ticks=240", "Agent A2 did not resolve within max_ticks=240", "Agent A3 did not resolve within max_ticks=240"],
    });

    const stranded = buildRecommendations(scenario(), result).find((r) => r.id === "tick-limit");

    expect(stranded?.severity).toBe("critical");
    expect(stranded?.title).toContain("3");
    expect(stranded?.detail).toContain("120 min");
  });

  it("lists shelters that turned arrivals away", () => {
    const result = run({ shelters: [{ shelterId: "S1", totalCapacity: 10, finalOccupied: 10, rejectedCount: 2 }] });

    expect(buildRecommendations(scenario(), result).find((r) => r.id === "rejected-S1")?.title).toContain("School");
  });

  it("notes hazard-exposed routes and orders critical findings first", () => {
    const result = run({
      metrics: { evacuatedCount: 7, unservedCount: 3, completionTick: null, hitTickLimit: true, maxCongestionRatio: 1, runtimeMs: 1 },
      warnings: ["Agent A1 did not resolve within max_ticks=240"],
    });

    const recs = buildRecommendations(scenario(), result);

    expect(recs.find((r) => r.id === "hazard-exposure")?.detail).toContain("E1 (20% risk)");
    expect(recs[0].severity).toBe("critical");
  });

  it("confirms a clean run without inventing problems", () => {
    const recs = buildRecommendations(scenario({ edges: [{ id: "E1", source: "N1", target: "N2", lengthM: 100, capacityPerTick: 10, baseTravelTimeS: 60, status: "open", hazardRisk: 0 }] }), run());

    expect(recs).toHaveLength(1);
    expect(recs[0].id).toBe("all-clear");
    expect(recs[0].title).toContain("All 10 evacuees");
  });
});
