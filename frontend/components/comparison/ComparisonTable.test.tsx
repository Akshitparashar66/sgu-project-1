import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ComparisonResult } from "@/lib/schemas/types";
import { ComparisonTable } from "./ComparisonTable";

const comparison: ComparisonResult = {
  baselineRunId: "b", alternativeRunId: "a",
  metrics: [
    { metricName: "Unserved agents", baselineValue: 10, alternativeValue: 0, absoluteDiff: -10, percentDiff: -100, improved: true },
    { metricName: "Peak congestion ratio", baselineValue: 1, alternativeValue: 1.5, absoluteDiff: 0.5, percentDiff: 50, improved: false },
    { metricName: "Evacuated agents", baselineValue: 0, alternativeValue: 0, absoluteDiff: 0, percentDiff: null, improved: null },
  ],
  warnings: ["'Evacuated agents' baseline is 0 — percentage change is undefined"],
};

describe("ComparisonTable", () => {
  it("renders one row per metric with a glyph AND a word, never color alone (PRD §8.8, §12.3)", () => {
    render(<ComparisonTable comparison={comparison} />);

    const rows = screen.getAllByRole("row").slice(1); // skip header
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("▲")).toBeInTheDocument();
    expect(within(rows[0]).getByText("improved")).toBeInTheDocument();
    expect(within(rows[1]).getByText("▼")).toBeInTheDocument();
    expect(within(rows[1]).getByText("worse")).toBeInTheDocument();
    expect(within(rows[2]).getByText("—")).toBeInTheDocument();
    expect(within(rows[2]).getByText("n/a")).toBeInTheDocument();
  });

  it("never grades simulation runtime as a plan outcome", () => {
    render(<ComparisonTable comparison={{
      ...comparison,
      metrics: [{ metricName: "Simulation runtime (ms)", baselineValue: 100, alternativeValue: 110, absoluteDiff: 10, percentDiff: 10, improved: false }],
    }} />);

    expect(screen.queryByText("worse")).not.toBeInTheDocument();
    expect(screen.getByText("compute cost, not a plan outcome")).toBeInTheDocument();
  });

  it("shows the comparison's own warnings", () => {
    render(<ComparisonTable comparison={comparison} />);
    expect(screen.getByText(/percentage change is undefined/)).toBeInTheDocument();
  });
});
