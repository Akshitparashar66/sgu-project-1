import type { ArrivalsPoint } from "./replay";

export type MergedRow = { minutes: number } & Record<string, number>;

/**
 * Join cumulative series on the time axis. A series that finished earlier
 * holds its final value (cumulative counts never drop back), so lines of
 * different length stay comparable to the end of the longest run.
 */
export function mergeSeries(series: { id: string; points: ArrivalsPoint[] }[]): MergedRow[] {
  const length = Math.max(0, ...series.map((s) => s.points.length));
  const longest = series.find((s) => s.points.length === length);
  if (!longest) return [];
  return longest.points.map((point, i) => {
    const row: MergedRow = { minutes: point.minutes };
    for (const s of series) {
      row[s.id] = (s.points[i] ?? s.points[s.points.length - 1])?.arrived ?? 0;
    }
    return row;
  });
}
