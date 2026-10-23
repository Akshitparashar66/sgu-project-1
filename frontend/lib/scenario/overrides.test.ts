import { describe, expect, it } from "vitest";
import type { ScenarioConfig } from "@/lib/schemas/types";
import { applyOverrides, hasOverrides, toggleId } from "./overrides";

const scenario = {
  edges: [{ id: "E1", status: "open" }, { id: "E2", status: "open" }],
  shelters: [{ id: "S1", available: true }, { id: "S2", available: true }],
} as unknown as ScenarioConfig;

describe("applyOverrides", () => {
  it("closes edges and disables shelters on a copy, mirroring the backend", () => {
    const result = applyOverrides(scenario, { closedEdgeIds: ["E2"], unavailableShelterIds: ["S1"] });

    expect(result.edges.map((e) => e.status)).toEqual(["open", "closed"]);
    expect(result.shelters.map((s) => s.available)).toEqual([false, true]);
    expect(scenario.edges[1].status).toBe("open");
    expect(scenario.shelters[0].available).toBe(true);
  });

  it("returns the same object when there is nothing to override", () => {
    expect(applyOverrides(scenario, { closedEdgeIds: [], unavailableShelterIds: [] })).toBe(scenario);
  });
});

describe("toggleId / hasOverrides", () => {
  it("adds a missing id and removes a present one", () => {
    expect(toggleId(["E1"], "E2")).toEqual(["E1", "E2"]);
    expect(toggleId(["E1", "E2"], "E1")).toEqual(["E2"]);
  });

  it("reports whether any what-if change is active", () => {
    expect(hasOverrides({ closedEdgeIds: [], unavailableShelterIds: [] })).toBe(false);
    expect(hasOverrides({ closedEdgeIds: ["E1"], unavailableShelterIds: [] })).toBe(true);
  });
});
