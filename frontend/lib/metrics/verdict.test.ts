import { describe, expect, it } from "vitest";
import type { ComparisonResult, MetricComparison } from "@/lib/schemas/types";
import { verdictSummary } from "./verdict";

const metric = (metricName: string, improved: boolean | null, percentDiff: number | null = null): MetricComparison =>
  ({ metricName, baselineValue: 1, alternativeValue: 1, absoluteDiff: 0, percentDiff, improved });

const comparison = (metrics: MetricComparison[]): ComparisonResult =>
  ({ baselineRunId: "b", alternativeRunId: "a", metrics, warnings: [] });

describe("verdictSummary", () => {
  it("names exactly what got better and what got worse, with the size of each change", () => {
    const summary = verdictSummary(comparison([
      metric("Peak congestion ratio", true, -1.3),
      metric("Clearance time (min)", false, 0.8),
      metric("Unserved agents", null),
    ]));

    expect(summary.improved).toEqual(["peak congestion ratio (-1.3%)"]);
    expect(summary.worse).toEqual(["clearance time (min) (+0.8%)"]);
  });

  it("never counts simulation runtime as a plan outcome", () => {
    const summary = verdictSummary(comparison([metric("Simulation runtime (ms)", true, -30)]));

    expect(summary.improved).toEqual([]);
  });
});
