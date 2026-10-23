import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ScenarioConfig } from "@/lib/schemas/types";
import { initialAegisState } from "@/lib/state/aegisReducer";
import { BriefingCard } from "./BriefingCard";

const requestBriefing = vi.fn();
vi.mock("@/lib/api/client", () => ({ requestBriefing: (...args: unknown[]) => requestBriefing(...args) }));

const scenario = { id: "scenario_b", defaultParams: { randomSeed: 42 } } as unknown as ScenarioConfig;
const state = {
  ...initialAegisState, scenario, seed: 7, overrides: { closedEdgeIds: ["E3"], unavailableShelterIds: [] },
};

describe("BriefingCard", () => {
  it("requests a briefing for the exact inputs on screen and labels who wrote it", async () => {
    requestBriefing.mockResolvedValue({ source: "gemini", text: "First paragraph.\n\nSecond paragraph.", facts: {}, warnings: [] });
    render(<BriefingCard state={state} includePlan />);

    fireEvent.click(screen.getByRole("button", { name: "Write briefing" }));

    expect(await screen.findByText("Second paragraph.")).toBeInTheDocument();
    expect(screen.getByText(/Written by Gemini/)).toBeInTheDocument();
    expect(requestBriefing).toHaveBeenCalledWith({
      scenarioId: "scenario_b", randomSeed: 7, includePlan: true, closedEdgeIds: ["E3"], unavailableShelterIds: [],
    });
  });

  it("shows the fallback summary with the reason AI wasn't used", async () => {
    requestBriefing.mockResolvedValue({ source: "template", text: "750 of 750 reached a shelter.", facts: {}, warnings: ["AI is not configured."] });
    render(<BriefingCard state={state} />);

    fireEvent.click(screen.getByRole("button", { name: "Write briefing" }));

    expect(await screen.findByText("750 of 750 reached a shelter.")).toBeInTheDocument();
    expect(screen.getByText(/Standard summary/)).toBeInTheDocument();
    expect(screen.getByText("AI is not configured.")).toBeInTheDocument();
  });
});
