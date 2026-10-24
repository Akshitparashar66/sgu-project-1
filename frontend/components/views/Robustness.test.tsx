import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PlanRobustness } from "@/lib/api/client";
import { Robustness } from "./ComparisonView";

const pct = (p10: number, p50: number, p90: number) => ({ p10, p50, p90 });
const robustness: PlanRobustness = {
  variations: 40,
  assumptions: ["walking speed ±15%"],
  baseline: { clearanceMinutes: pct(50, 50, 50), unserved: pct(50, 50, 118), averageMinutes: pct(22, 24, 27), hitTimeLimit: 40 },
  optimized: { clearanceMinutes: pct(33.5, 37, 42), unserved: pct(0, 0, 0), averageMinutes: pct(18, 20, 23), hitTimeLimit: 0 },
  optimizedBetter: 38,
};

describe("Robustness", () => {
  it("shows ranges for both plans, how often the optimized one wins, and when a plan ran out of time", () => {
    render(<Robustness robustness={robustness} />);

    expect(screen.getByText("38 of 40")).toBeInTheDocument();
    expect(screen.getByText("33.5–42 min (typically 37)")).toBeInTheDocument();
    expect(screen.getByText("50 min")).toBeInTheDocument(); // no spread: a single value
    expect(screen.getByText("50–118 (typically 50)")).toBeInTheDocument();
    expect(screen.getByText(/Ran out of time in 40 of 40 variations \(baseline\)/)).toBeInTheDocument();
  });
});
