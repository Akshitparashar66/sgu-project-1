import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ScenarioConfig } from "@/lib/schemas/types";
import { initialAegisState } from "@/lib/state/aegisReducer";
import type { AegisActions } from "@/lib/state/useAegis";
import { ScenarioLabView } from "./ScenarioLabView";

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  predictOutcome: vi.fn(() => new Promise(() => {})),
  findWeakPoints: vi.fn(() => new Promise(() => {})),
}));

const scenario: ScenarioConfig = {
  id: "s", name: "Normal", description: "", synthetic: true,
  nodes: [{ id: "N1", lat: 0, lon: 0 }, { id: "N2", lat: 0, lon: 0 }],
  edges: [{ id: "E3", source: "N1", target: "N2", lengthM: 500, capacityPerTick: 20, baseTravelTimeS: 60, status: "open", hazardRisk: 0.1 }],
  zones: [{ id: "Z1", name: "Riverside", connectorNode: "N1", evacueeCount: 300, movementProfile: { standard: 1 } }],
  shelters: [{ id: "S1", name: "School", connectorNode: "N2", totalCapacity: 250, occupied: 0, available: true }],
  hazards: [],
  defaultParams: { tickSeconds: 30, maxTicks: 240, randomSeed: 42 },
};

function stubActions(): AegisActions {
  return {
    loadScenario: vi.fn(), openScenario: vi.fn(), run: vi.fn(), generatePlan: vi.fn(), toggleEdge: vi.fn(), toggleShelter: vi.fn(),
    clearOverrides: vi.fn(), setSeed: vi.fn(), select: vi.fn(), reset: vi.fn(),
  };
}

describe("ScenarioLabView", () => {
  it("offers every road and shelter change from the keyboard, not only by clicking the map (PRD §12.3)", () => {
    const actions = stubActions();
    render(<ScenarioLabView state={{ ...initialAegisState, scenario }} effectiveScenario={scenario} actions={actions} onRunComplete={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Close road E3" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark shelter S1 unavailable" }));

    expect(actions.toggleEdge).toHaveBeenCalledWith("E3");
    expect(actions.toggleShelter).toHaveBeenCalledWith("S1");
  });
});
