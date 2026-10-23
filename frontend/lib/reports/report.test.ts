import { describe, expect, it } from "vitest";
import type { AgentResult, RunResult, ScenarioConfig } from "@/lib/schemas/types";
import { roadReport, zoneOutcomes } from "./report";

const scenario = {
  nodes: [{ id: "N1", lat: 0, lon: 0, label: "Junction" }, { id: "N2", lat: 0, lon: 0 }],
  edges: [
    { id: "E1", source: "N1", target: "N2", capacityPerTick: 10, hazardRisk: 0 },
    { id: "E2", source: "N2", target: "N1", capacityPerTick: 10, hazardRisk: 0 },
  ],
  zones: [{ id: "Z1", name: "Riverside", evacueeCount: 3 }, { id: "Z2", name: "Market", evacueeCount: 1 }],
  defaultParams: { tickSeconds: 30 },
} as unknown as ScenarioConfig;

const agent = (fields: Partial<AgentResult>): AgentResult => ({
  id: "a", originZone: "Z1", assignedShelter: "S1", routeEdgeIds: ["E1"], status: "arrived", arrivalTick: 2,
  movementProfile: "standard", edgeEntryTicks: [], edgeExitTicks: [], ...fields,
});

const run = {
  agents: [
    agent({ arrivalTick: 2 }), agent({ arrivalTick: 6 }), agent({ status: "unserved", arrivalTick: undefined }),
    agent({ originZone: "Z2", arrivalTick: 4, routeEdgeIds: ["E2"] }),
  ],
  congestion: [
    { edgeId: "E1", peakDemandToCapacity: 3.5, peakTick: 0, totalDelayS: 7200 },
    { edgeId: "E2", peakDemandToCapacity: 0.4, peakTick: 1, totalDelayS: 0 },
  ],
} as unknown as RunResult;

describe("zoneOutcomes", () => {
  it("reports arrivals, unserved and mean evacuation time per zone", () => {
    expect(zoneOutcomes(scenario, run)).toEqual([
      { zoneId: "Z1", name: "Riverside", evacuees: 3, arrived: 2, unserved: 1, meanArrivalMinutes: 2 },
      { zoneId: "Z2", name: "Market", evacuees: 1, arrived: 1, unserved: 0, meanArrivalMinutes: 2 },
    ]);
  });
});

describe("roadReport", () => {
  it("ranks roads by peak congestion with routed headcount and delay in agent-hours", () => {
    const rows = roadReport(scenario, run);

    expect(rows.map((r) => r.edgeId)).toEqual(["E1", "E2"]);
    expect(rows[0]).toMatchObject({ from: "Junction", to: "N2", routed: 3, peakRatio: 3.5, delayHours: 2 });
  });
});
