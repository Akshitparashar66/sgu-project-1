import { describe, expect, it } from "vitest";
import type { AgentResult, ScenarioConfig } from "@/lib/schemas/types";
import { clusterResolvedAgents } from "./agentClusters";

const scenario = {
  nodes: [{ id: "N1", lat: 0, lon: 0 }, { id: "N4", lat: 1, lon: 1 }, { id: "N6", lat: 2, lon: 2 }],
  edges: [
    { id: "E6", source: "N4", target: "N6" }, // traversed N6 -> N4 below: target is NOT the endpoint
  ],
  zones: [{ id: "Z1", connectorNode: "N1" }],
  shelters: [{ id: "S1", connectorNode: "N4" }],
} as unknown as ScenarioConfig;

function agent(id: string, status: AgentResult["status"], assignedShelter?: string): AgentResult {
  return { id, originZone: "Z1", assignedShelter, routeEdgeIds: ["E6"], status, movementProfile: "standard", edgeEntryTicks: [], edgeExitTicks: [] };
}

describe("clusterResolvedAgents", () => {
  it("places arrived agents at their assigned shelter, even when the last edge was walked in reverse", () => {
    const clusters = clusterResolvedAgents(scenario, [agent("a", "arrived", "S1"), agent("b", "arrived", "S1")]);

    expect(clusters).toEqual([{ key: "arrived:N4", nodeId: "N4", status: "arrived", count: 2 }]);
  });

  it("places unserved agents at their origin zone and ignores agents still in motion", () => {
    const clusters = clusterResolvedAgents(scenario, [agent("a", "unserved"), agent("b", "moving", "S1")]);

    expect(clusters).toEqual([{ key: "unserved:N1", nodeId: "N1", status: "unserved", count: 1 }]);
  });
});
