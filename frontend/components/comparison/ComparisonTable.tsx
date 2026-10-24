import { formatImprovement, formatPercentDiff } from "@/lib/metrics/format";
import { COMPUTE_ONLY_METRICS } from "@/lib/metrics/verdict";
import type { ComparisonResult } from "@/lib/schemas/types";

const OUTCOME = {
  improved: { glyph: "▲", className: "text-green-700" },
  worse: { glyph: "▼", className: "text-red-600" },
  unchanged: { glyph: "—", className: "text-slate-500" },
} as const;

function formatValue(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
}

function formatSigned(value: number): string {
  return `${value > 0 ? "+" : ""}${formatValue(value)}`;
}

export function ComparisonTable({ comparison }: { comparison: ComparisonResult }) {
  return (
    <div>
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Baseline versus optimized plan, metric by metric</caption>
        <thead className="text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="py-2 pr-3 font-medium">Metric</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Baseline</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Optimized</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Change</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">%</th>
            <th scope="col" className="py-2 font-medium">Result</th>
          </tr>
        </thead>
        <tbody>
          {comparison.metrics.map((m) => {
            const computeOnly = COMPUTE_ONLY_METRICS.has(m.metricName);
            const outcome = formatImprovement(m);
            const style = OUTCOME[outcome];
            return (
              <tr key={m.metricName} className={`border-t border-slate-200 ${computeOnly ? "text-slate-500" : ""}`}>
                <th scope="row" className={`py-2 pr-3 font-normal ${computeOnly ? "" : "text-slate-800"}`}>{m.metricName}</th>
                <td className="py-2 pr-3 text-right tabular-nums">{formatValue(m.baselineValue)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatValue(m.alternativeValue)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatSigned(m.absoluteDiff)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatPercentDiff(m)}</td>
                {computeOnly ? (
                  <td className="py-2 text-xs">compute cost, not a plan outcome</td>
                ) : (
                  <td className={`py-2 ${style.className}`}>
                    <span aria-hidden className="mr-1.5">{style.glyph}</span>
                    <span>{outcome}</span>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {comparison.warnings.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-amber-700">
          {comparison.warnings.map((w) => <li key={w}>⚠ {w}</li>)}
        </ul>
      )}
    </div>
  );
}
