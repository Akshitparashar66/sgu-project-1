import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ScenarioConfig } from "@/lib/schemas/types";
import { initialAegisState } from "@/lib/state/aegisReducer";
import type { AegisActions } from "@/lib/state/useAegis";
import { WeakPoints } from "./WeakPoints";

const findWeakPoints = vi.fn();
vi.mock("@/lib/api/client", () => ({ findWeakPoints: (...args: unknown[]) => findWeakPoints(...args) }));

const state = { ...initialAegisState, scenario: { id: "scenario_a_normal" } as ScenarioConfig, seed: 7 };

describe("WeakPoints", () => {
  it("ranks each loss with its effect and lets the planner try it", async () => {
    findWeakPoints.mockResolvedValue({
      baseline: { unserved: 0, clearanceMinutes: 59, hitTimeLimit: false },
      items: [
        { kind: "shelter", id: "S2", label: "Community Centre", unservedChange: 400, clearanceChangeMinutes: -13, hitTimeLimit: false },
        { kind: "road", id: "E1", label: "Bypass", unservedChange: 0, clearanceChangeMinutes: 24.5, hitTimeLimit: false },
        { kind: "road", id: "E4", label: "Bypass by ground", unservedChange: 0, clearanceChangeMinutes: -1, hitTimeLimit: false },
      ],
    });
    const actions = { toggleEdge: vi.fn(), toggleShelter: vi.fn() } as unknown as AegisActions;
    render(<WeakPoints state={state} actions={actions} />);

    fireEvent.click(screen.getByRole("button", { name: "Find weak points" }));

    expect(await screen.findByText("+400 unserved")).toBeInTheDocument(); // its faster clearance is not a gain
    expect(screen.getByText("+24.5 min clearance")).toBeInTheDocument();
    expect(screen.getByText("−1 min clearance")).toBeInTheDocument();
    expect(findWeakPoints).toHaveBeenCalledWith({ scenarioId: "scenario_a_normal", randomSeed: 7, closedEdgeIds: [], unavailableShelterIds: [] });
    fireEvent.click(screen.getByRole("button", { name: "Try losing road E1" }));
    expect(actions.toggleEdge).toHaveBeenCalledWith("E1");
  });
});
