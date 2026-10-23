import { describe, expect, it } from "vitest";
import { mergeSeries } from "./mergeSeries";

describe("mergeSeries", () => {
  it("joins cumulative series on minutes and carries a finished series' final value forward", () => {
    const rows = mergeSeries([
      { id: "baseline", points: [{ tick: 0, minutes: 0, arrived: 0 }, { tick: 1, minutes: 0.5, arrived: 4 }] },
      { id: "alternative", points: [{ tick: 0, minutes: 0, arrived: 1 }, { tick: 1, minutes: 0.5, arrived: 3 }, { tick: 2, minutes: 1, arrived: 6 }] },
    ]);

    expect(rows).toEqual([
      { minutes: 0, baseline: 0, alternative: 1 },
      { minutes: 0.5, baseline: 4, alternative: 3 },
      { minutes: 1, baseline: 4, alternative: 6 },
    ]);
  });
});
