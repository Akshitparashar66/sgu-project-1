import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WhatIfProposal } from "@/lib/api/client";
import type { ScenarioConfig } from "@/lib/schemas/types";
import { initialAegisState } from "@/lib/state/aegisReducer";
import type { AegisActions } from "@/lib/state/useAegis";
import { WhatIfAssistant } from "./WhatIfAssistant";

const interpretWhatIf = vi.fn();
vi.mock("@/lib/api/client", () => ({ interpretWhatIf: (...args: unknown[]) => interpretWhatIf(...args) }));

const scenario: ScenarioConfig = {
  id: "s", name: "Normal", description: "", synthetic: true,
  nodes: [{ id: "N1", lat: 0, lon: 0, label: "Bypass" }, { id: "N2", lat: 0, lon: 0, label: "North" }],
  edges: [{ id: "E3", source: "N1", target: "N2", lengthM: 500, capacityPerTick: 20, baseTravelTimeS: 60, status: "open", hazardRisk: 0.1 }],
  zones: [],
  shelters: [{ id: "S1", name: "School Camp", connectorNode: "N2", totalCapacity: 250, occupied: 0, available: true }],
  hazards: [],
  defaultParams: { tickSeconds: 30, maxTicks: 240, randomSeed: 42 },
};

const proposal: WhatIfProposal = {
  source: "gemini", closeEdgeIds: ["E3"], reopenEdgeIds: [], unavailableShelterIds: ["S1"], restoreShelterIds: [],
  interpretation: "Close E3 and take S1 offline.", unmatched: ["heavy rain"], warnings: [],
};

function setup() {
  const actions = { applyChanges: vi.fn() } as unknown as AegisActions;
  render(<WhatIfAssistant state={{ ...initialAegisState, scenario }} scenario={scenario} actions={actions} />);
  fireEvent.change(screen.getByLabelText("What-if question"), { target: { value: "flood the link, lose the camp, rain" } });
  fireEvent.click(screen.getByRole("button", { name: "Interpret" }));
  return actions;
}

describe("WhatIfAssistant", () => {
  beforeEach(() => interpretWhatIf.mockReset());

  it("shows the proposed changes and applies them only when confirmed", async () => {
    interpretWhatIf.mockResolvedValue(proposal);
    const actions = setup();

    expect(await screen.findByText("Close Road E3 (Bypass — North)")).toBeInTheDocument();
    expect(screen.getByText("Take School Camp (S1) offline")).toBeInTheDocument();
    expect(screen.getByText(/Not something the simulator can change: heavy rain/)).toBeInTheDocument();
    expect(actions.applyChanges).not.toHaveBeenCalled();
    expect(interpretWhatIf).toHaveBeenCalledWith(expect.objectContaining({ scenarioId: "s", question: "flood the link, lose the camp, rain" }));

    fireEvent.click(screen.getByRole("button", { name: "Apply these changes" }));
    expect(actions.applyChanges).toHaveBeenCalledWith(proposal);
  });

  it("can't apply a proposal with no changes, and says when matching was offline", async () => {
    interpretWhatIf.mockResolvedValue({ ...proposal, source: "keywords", closeEdgeIds: [], unavailableShelterIds: [] });
    setup();

    expect(await screen.findByText("No road or shelter changes matched this question.")).toBeInTheDocument();
    expect(screen.getByText("Matched by keyword (AI unavailable).")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply these changes" })).toBeDisabled();
  });
});
