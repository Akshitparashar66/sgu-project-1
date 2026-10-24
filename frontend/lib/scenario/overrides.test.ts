import { describe, expect, it } from "vitest";
import type { ScenarioConfig } from "@/lib/schemas/types";
import { applyOverrides, hasOverrides, toggleId, withCapacity } from "./overrides";

const scenario = {
  edges: [{ id: "E1", status: "open", capacityPerTick: 234 }, { id: "E2", status: "open", capacityPerTick: 176 }],
  shelters: [{ id: "S1", available: true }, { id: "S2", available: true }],
} as unknown as ScenarioConfig;

describe("applyOverrides", () => {
  it("closes edges and disables shelters on a copy, mirroring the backend", () => {
    const result = applyOverrides(scenario, { closedEdgeIds: ["E2"], unavailableShelterIds: ["S1"], edgeCapacityFactors: {} });

    expect(result.edges.map((e) => e.status)).toEqual(["open", "closed"]);
    expect(result.shelters.map((s) => s.available)).toEqual([false, true]);
    expect(scenario.edges[1].status).toBe("open");
    expect(scenario.shelters[0].available).toBe(true);
  });

  it("leaves a road a share of its capacity, never none, as the backend does", () => {
    const result = applyOverrides(scenario, { closedEdgeIds: [], unavailableShelterIds: [], edgeCapacityFactors: { E1: 0.5, E2: 0.001 } });
    expect(result.edges.map((e) => e.capacityPerTick)).toEqual([117, 1]);
    expect(scenario.edges[0].capacityPerTick).toBe(234);
  });

  it("returns the same object when there is nothing to override", () => {
    expect(applyOverrides(scenario, { closedEdgeIds: [], unavailableShelterIds: [], edgeCapacityFactors: {} })).toBe(scenario);
  });
});

describe("toggleId / hasOverrides", () => {
  it("adds a missing id and removes a present one", () => {
    expect(toggleId(["E1"], "E2")).toEqual(["E1", "E2"]);
    expect(toggleId(["E1", "E2"], "E1")).toEqual(["E2"]);
  });

  it("reports whether any what-if change is active", () => {
    expect(hasOverrides({ closedEdgeIds: [], unavailableShelterIds: [], edgeCapacityFactors: {} })).toBe(false);
    expect(hasOverrides({ closedEdgeIds: ["E1"], unavailableShelterIds: [], edgeCapacityFactors: {} })).toBe(true);
  });
});

describe("withCapacity", () => {
  it("sets a share and removes it at full capacity", () => {
    expect(withCapacity({}, "E4", 0.5)).toEqual({ E4: 0.5 });
    expect(withCapacity({ E4: 0.5, E1: 0.25 }, "E4", 1)).toEqual({ E1: 0.25 });
    expect(withCapacity({ E4: 0.5 }, "E4", null)).toEqual({});
  });
});
