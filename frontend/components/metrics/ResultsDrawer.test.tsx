import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RunResult } from "@/lib/schemas/types";
import { ResultsDrawer } from "./ResultsDrawer";

function buildResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    runId: "r1", scenarioId: "s1", planLabel: "baseline", randomSeed: 42,
    metrics: { evacuatedCount: 700, unservedCount: 50, completionTick: 120, hitTickLimit: false, maxCongestionRatio: 1.2, runtimeMs: 10 },
    agents: [], shelters: [{ shelterId: "S1", totalCapacity: 250, finalOccupied: 250, rejectedCount: 5 }],
    congestion: [], warnings: [],
    ...overrides,
  };
}

describe("ResultsDrawer", () => {
  it("shows a placeholder message when no run has completed yet", () => {
    render(<ResultsDrawer result={null} tickSeconds={30} />);
    expect(screen.getByText(/Run a simulation/i)).toBeInTheDocument();
  });

  it("shows evacuated, unserved and shelter occupancy from a real RunResult", () => {
    render(<ResultsDrawer result={buildResult()} tickSeconds={30} />);
    expect(screen.getByText("700")).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
    expect(screen.getByText(/250 \/ 250/)).toBeInTheDocument();
    expect(screen.getByText(/5 rejected/)).toBeInTheDocument();
  });

  it("collapses without losing the underlying data", () => {
    render(<ResultsDrawer result={buildResult()} tickSeconds={30} />);
    fireEvent.click(screen.getByRole("button", { name: /Collapse/i }));
    expect(screen.getByRole("button", { name: /Expand/i })).toHaveAttribute("aria-expanded", "false");
  });

  it("surfaces a warning when the run hit the tick limit", () => {
    render(<ResultsDrawer result={buildResult({ warnings: ["Agent A1 did not resolve within max_ticks=240"] })} tickSeconds={30} />);
    expect(screen.getByRole("alert")).toHaveTextContent("1 warning");
  });
});
