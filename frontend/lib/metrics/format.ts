import type { MetricComparison } from "@/lib/schemas/types";

export function formatPercentDiff(comparison: MetricComparison): string {
  if (comparison.percentDiff === null) return "n/a";
  const sign = comparison.percentDiff > 0 ? "+" : "";
  return `${sign}${comparison.percentDiff.toFixed(1)}%`;
}

export function formatImprovement(comparison: MetricComparison): "improved" | "worse" | "unchanged" {
  if (comparison.improved === null) return "unchanged";
  return comparison.improved ? "improved" : "worse";
}

export function formatCompletionTick(
  completionTick: number | null, hitTickLimit: boolean, tickSeconds: number
): string {
  if (hitTickLimit) return "Time limit reached";
  if (completionTick === null) return "n/a";
  const totalSeconds = completionTick * tickSeconds;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}m ${seconds}s`;
}

export function formatOccupancy(occupied: number, totalCapacity: number): string {
  const pct = totalCapacity > 0 ? Math.round((occupied / totalCapacity) * 100) : 0;
  return `${occupied} / ${totalCapacity} (${pct}%)`;
}
