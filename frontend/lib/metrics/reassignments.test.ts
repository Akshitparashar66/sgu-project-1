import { describe, expect, it } from "vitest";
import type { PlanChange } from "@/lib/api/client";
import { summarizeReassignments } from "./reassignments";

const change = (originZone: string, oldShelter: string | null, newShelter: string | null): PlanChange =>
  ({ agentId: "x", originZone, oldShelter, newShelter, reason: "" });

describe("summarizeReassignments", () => {
  it("groups individual agent changes into zone-level moves, largest first", () => {
    const summary = summarizeReassignments([
      change("Z1", "S1", "S2"), change("Z2", "S3", "S2"), change("Z2", "S3", "S2"), change("Z1", "S1", "S2"), change("Z2", "S3", "S2"),
    ]);

    expect(summary).toEqual([
      { originZone: "Z2", from: "S3", to: "S2", count: 3 },
      { originZone: "Z1", from: "S1", to: "S2", count: 2 },
    ]);
  });

  it("labels a missing shelter as unassigned", () => {
    expect(summarizeReassignments([change("Z1", null, "S2")])[0].from).toBe("unassigned");
  });
});
