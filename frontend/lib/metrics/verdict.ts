import type { ComparisonResult } from "@/lib/schemas/types";
import { formatPercentDiff } from "./format";

// Reported by the API for transparency, but it measures the computer, not
// the evacuation — it must never count for or against a plan.
export const COMPUTE_ONLY_METRICS = new Set(["Simulation runtime (ms)"]);

/** What the alternative actually changed, in words — so a headline never overstates a marginal gain. */
export function verdictSummary(comparison: ComparisonResult): { improved: string[]; worse: string[] } {
  const describe = (name: string, pct: string) => `${name.toLowerCase()} (${pct})`;
  const planMetrics = comparison.metrics.filter((m) => !COMPUTE_ONLY_METRICS.has(m.metricName));
  return {
    improved: planMetrics.filter((m) => m.improved === true).map((m) => describe(m.metricName, formatPercentDiff(m))),
    worse: planMetrics.filter((m) => m.improved === false).map((m) => describe(m.metricName, formatPercentDiff(m))),
  };
}
