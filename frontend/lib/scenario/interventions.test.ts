import { describe, expect, it } from "vitest";
import type { ScenarioConfig } from "@/lib/schemas/types";
import { applyInterventions } from "./interventions";

const scenario = {
  edges: [{ id: "E4", capacityPerTick: 234 }, { id: "E5", capacityPerTick: 100 }],
  shelters: [{ id: "S3", available: true }, { id: "S4", available: false, standby: true }],
} as unknown as ScenarioConfig;

describe("applyInterventions", () => {
  it("opens the standby shelters and widens the marshalled roads the plan chose", () => {
    const changed = applyInterventions(scenario, { openedShelters: [{ shelterId: "S4", name: "Hall" }], marshalledRoads: ["E4"] });
    expect(changed.shelters.find((s) => s.id === "S4")?.available).toBe(true);
    expect(changed.edges.map((e) => e.capacityPerTick)).toEqual([293, 100]);
  });

  it("leaves the scenario alone when the plan changes nothing", () => {
    expect(applyInterventions(scenario, { openedShelters: [], marshalledRoads: [] })).toBe(scenario);
  });
});
