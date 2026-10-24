"use client";

import { Loader2, ShieldAlert } from "lucide-react";
import { useState } from "react";

import { Card } from "@/components/ui/Card";
import { findWeakPoints, type WeakPointReport } from "@/lib/api/client";
import type { AegisState } from "@/lib/state/aegisReducer";
import type { AegisActions } from "@/lib/state/useAegis";

function effect(unserved: number, minutes: number, hitTimeLimit: boolean): string {
  const parts = [];
  if (unserved !== 0) parts.push(`${unserved > 0 ? "+" : ""}${unserved.toLocaleString()} unserved`);
  if (hitTimeLimit) parts.push("runs out of time");
  // A faster clearance because people lost their place (and never set off) isn't a gain: don't show it.
  else if (minutes > 0 || (minutes < 0 && unserved <= 0)) parts.push(`${minutes > 0 ? "+" : "−"}${Math.abs(minutes)} min clearance`);
  return parts.join(", ") || "no measurable effect";
}

/**
 * Single-failure analysis of the current setup: which road or shelter, if
 * lost, hurts the evacuation most. Exact re-simulation of each failure.
 */
export function WeakPoints({ state, actions }: { state: AegisState; actions: AegisActions }) {
  const [report, setReport] = useState<WeakPointReport | null>(null);
  const [inputs, setInputs] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = JSON.stringify([state.scenario?.id, state.seed, state.overrides]);

  async function analyse() {
    if (!state.scenario) return;
    setLoading(true);
    setError(null);
    try {
      setReport(await findWeakPoints({ scenarioId: state.scenario.id, randomSeed: state.seed, ...state.overrides }));
      setInputs(current);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const stale = report !== null && inputs !== current;
  return (
    <Card
      title="Weak points"
      actions={
        <button
          type="button"
          onClick={analyse}
          disabled={loading || !state.scenario}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          {loading ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <ShieldAlert size={13} aria-hidden />}
          {report ? "Re-check" : "Find weak points"}
        </button>
      }
    >
      {!report && !error && (
        <p className="text-sm text-slate-500">
          Simulates losing each open road and each available shelter, one at a time, and ranks them by how much worse the evacuation gets.
        </p>
      )}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {report && (
        <>
          {stale && <p className="mb-2 text-xs text-amber-700">Computed before your latest changes. Re-check to update.</p>}
          <ol className="space-y-1.5 text-sm">
            {report.items.map((item) => {
              const worse = item.unservedChange > 0 || item.clearanceChangeMinutes > 0 || item.hitTimeLimit;
              return (
                <li key={`${item.kind}-${item.id}`} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-slate-100 pt-1.5 first:border-0 first:pt-0">
                  <span className="min-w-0 text-slate-700">
                    <span className="font-medium text-slate-900">{item.kind === "road" ? "Road" : "Shelter"} {item.id}</span>{" "}
                    <span className="text-slate-500">{item.label}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className={`tabular-nums ${worse ? "text-red-700" : "text-slate-500"}`}>
                      {effect(item.unservedChange, item.clearanceChangeMinutes, item.hitTimeLimit && !report.baseline.hitTimeLimit)}
                    </span>
                    <button
                      type="button"
                      onClick={() => (item.kind === "road" ? actions.toggleEdge(item.id) : actions.toggleShelter(item.id))}
                      aria-label={`Try losing ${item.kind} ${item.id}`}
                      className="rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100"
                    >
                      Try it
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="mt-2 text-xs text-slate-500">
            Compared with the current setup ({report.baseline.unserved.toLocaleString()} unserved, clearing in {report.baseline.clearanceMinutes} min),
            using the default plan. A loss that makes things faster is real: fewer options can spread people more evenly.
          </p>
        </>
      )}
    </Card>
  );
}
