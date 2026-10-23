import { formatImprovement, formatPercentDiff } from "@/lib/metrics/format";
import type { ComparisonResult } from "@/lib/schemas/types";

const OUTCOME = {
  improved: { glyph: "▲", className: "text-green-400" },
  worse: { glyph: "▼", className: "text-red-400" },
  unchanged: { glyph: "—", className: "text-slate-400" },
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
        <caption className="sr-only">Baseline versus alternative plan, metric by metric</caption>
        <thead className="text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="py-2 pr-3 font-medium">Metric</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Baseline</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Alternative</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Change</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">%</th>
            <th scope="col" className="py-2 font-medium">Result</th>
          </tr>
        </thead>
        <tbody>
          {comparison.metrics.map((m) => {
            const outcome = formatImprovement(m);
            const style = OUTCOME[outcome];
            return (
              <tr key={m.metricName} className="border-t border-slate-800">
                <th scope="row" className="py-2 pr-3 font-normal text-slate-200">{m.metricName}</th>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-300">{formatValue(m.baselineValue)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-100">{formatValue(m.alternativeValue)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-300">{formatSigned(m.absoluteDiff)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-300">{formatPercentDiff(m)}</td>
                <td className={`py-2 ${style.className}`}>
                  <span aria-hidden className="mr-1.5">{style.glyph}</span>
                  <span>{outcome}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {comparison.warnings.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-amber-400">
          {comparison.warnings.map((w) => <li key={w}>⚠ {w}</li>)}
        </ul>
      )}
    </div>
  );
}
