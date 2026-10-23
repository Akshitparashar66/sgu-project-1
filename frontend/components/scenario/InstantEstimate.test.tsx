import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OutcomeEstimate } from "@/lib/api/client";
import type { RunResult, ScenarioConfig } from "@/lib/schemas/types";
import { initialAegisState, runKey } from "@/lib/state/aegisReducer";
import { InstantEstimate } from "./InstantEstimate";

const predictOutcome = vi.fn();
vi.mock("@/lib/api/client", () => ({ predictOutcome: (...args: unknown[]) => predictOutcome(...args) }));

const scenario = { id: "scenario_a", defaultParams: { tickSeconds: 30, maxTicks: 240, randomSeed: 42 } } as unknown as ScenarioConfig;
const metric = (labP90AbsError: number) => ({ mae: 1, p90AbsError: 2, labMae: 1, labP90AbsError, r2: 0.9 });
const estimate: OutcomeEstimate = {
  available: true, clearanceMinutes: 97.6, clearanceAtTimeLimit: false, unservedCount: 12, peakCongestion: 2.31,
  evacuees: 1500, runtimeMs: 8,
  model: {
    method: "gradient-boosted decision trees", trainedOn: "AEGIS simulation runs", samples: 6400, testSamples: 1600,
    labTestSamples: 800, trainedDate: "2026-10-23",
    testMetrics: { clearanceMinutes: metric(6.4), unservedShare: metric(20), peakCongestion: metric(0.15) },
  },
};
const state = { ...initialAegisState, scenario, overrides: { closedEdgeIds: ["E3"], unavailableShelterIds: [] } };

describe("InstantEstimate", () => {
  beforeEach(() => predictOutcome.mockReset());

  it("estimates the current what-if with its tested error range, before anything is run", async () => {
    predictOutcome.mockResolvedValue(estimate);
    render(<InstantEstimate state={state} scenario={scenario} />);

    expect(await screen.findByText("~98 min")).toBeInTheDocument();
    expect(screen.getByText("±6 min")).toBeInTheDocument();
    expect(screen.getByText("~12 of 1,500")).toBeInTheDocument();
    expect(screen.getByText("~2.31×")).toBeInTheDocument();
    expect(screen.getByText(/Run the simulation for the real numbers/)).toBeInTheDocument();
    expect(predictOutcome).toHaveBeenCalledWith(
      { scenarioId: "scenario_a", closedEdgeIds: ["E3"], unavailableShelterIds: [] }, expect.any(AbortSignal),
    );
  });

  it("shows the simulation's numbers next to the estimate once this exact setup has been run", async () => {
    predictOutcome.mockResolvedValue(estimate);
    const run = { metrics: { completionTick: 196, unservedCount: 0, maxCongestionRatio: 2.32 } } as unknown as RunResult;
    render(<InstantEstimate state={{ ...state, run, runInputs: runKey(state) }} scenario={scenario} />);

    expect(await screen.findByText("98 min")).toBeInTheDocument(); // 196 ticks × 30 s
    expect(screen.getByText("2.32×")).toBeInTheDocument();
  });

  it("explains when no trained model is installed", async () => {
    predictOutcome.mockResolvedValue({ available: false, reason: "No trained model found." });
    render(<InstantEstimate state={state} scenario={scenario} />);

    expect(await screen.findByText("No trained model found.")).toBeInTheDocument();
  });
});
