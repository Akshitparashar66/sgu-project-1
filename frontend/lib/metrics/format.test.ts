import { describe, expect, it } from "vitest";
import { formatCompletionTick, formatImprovement, formatOccupancy, formatPercentDiff } from "./format";

describe("formatPercentDiff", () => {
  it("shows n/a when percentDiff is null (baseline was zero) — PRD §8.8", () => {
    expect(formatPercentDiff({ metricName: "x", baselineValue: 0, alternativeValue: 5, absoluteDiff: 5, percentDiff: null, improved: null })).toBe("n/a");
  });

  it("formats a signed percentage otherwise", () => {
    expect(formatPercentDiff({ metricName: "x", baselineValue: 100, alternativeValue: 120, absoluteDiff: 20, percentDiff: 20, improved: true })).toBe("+20.0%");
    expect(formatPercentDiff({ metricName: "x", baselineValue: 100, alternativeValue: 80, absoluteDiff: -20, percentDiff: -20, improved: true })).toBe("-20.0%");
  });
});

describe("formatImprovement", () => {
  it("falls back to unchanged when improved is null (not meaningfully comparable)", () => {
    expect(formatImprovement({ metricName: "x", baselineValue: 0, alternativeValue: 0, absoluteDiff: 0, percentDiff: null, improved: null })).toBe("unchanged");
  });

  it("reports improved or worse otherwise", () => {
    expect(formatImprovement({ metricName: "x", baselineValue: 10, alternativeValue: 5, absoluteDiff: -5, percentDiff: -50, improved: true })).toBe("improved");
    expect(formatImprovement({ metricName: "x", baselineValue: 10, alternativeValue: 15, absoluteDiff: 5, percentDiff: 50, improved: false })).toBe("worse");
  });
});

describe("formatCompletionTick", () => {
  it("distinguishes a completed evacuation from one that hit the time limit — PRD §6.7", () => {
    expect(formatCompletionTick(null, true, 30)).toBe("Time limit reached");
    expect(formatCompletionTick(10, false, 30)).toBe("5m 0s");
  });
});

describe("formatOccupancy", () => {
  it("shows occupied/total and a percentage", () => {
    expect(formatOccupancy(85, 100)).toBe("85 / 100 (85%)");
    expect(formatOccupancy(0, 0)).toBe("0 / 0 (0%)");
  });
});
