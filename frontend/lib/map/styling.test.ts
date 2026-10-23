import { describe, expect, it } from "vitest";
import { agentMarkerColor, roadColor, roadDashArray, shelterFillColor } from "./styling";

describe("roadColor", () => {
  it("renders a closed road as red regardless of congestion", () => {
    expect(roadColor("closed", 0)).toBe("#ef4444");
  });

  it("renders an open, uncongested road as cyan", () => {
    expect(roadColor("open", 0.3)).toBe("#22d3ee");
  });

  it("renders an open road above capacity as amber, badly congested as red", () => {
    expect(roadColor("open", 1.2)).toBe("#f59e0b");
    expect(roadColor("open", 1.8)).toBe("#ef4444");
  });
});

describe("roadDashArray", () => {
  it("dashes closed roads, leaves open roads solid", () => {
    expect(roadDashArray("closed")).toBe("6 4");
    expect(roadDashArray("open")).toBeUndefined();
  });
});

describe("shelterFillColor", () => {
  it("colors by occupancy ratio: green < 80%, amber 80-99%, red at capacity", () => {
    expect(shelterFillColor(0, 100)).toBe("#22c55e");
    expect(shelterFillColor(85, 100)).toBe("#f59e0b");
    expect(shelterFillColor(100, 100)).toBe("#ef4444");
  });
});

describe("agentMarkerColor", () => {
  it("maps every AgentStatus to a distinct color", () => {
    const colors = new Set([
      agentMarkerColor("waiting"), agentMarkerColor("moving"),
      agentMarkerColor("delayed"), agentMarkerColor("arrived"),
      agentMarkerColor("unserved"),
    ]);
    expect(colors.size).toBe(5);
  });
});
