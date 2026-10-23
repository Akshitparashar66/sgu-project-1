"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useState } from "react";

import { Card } from "@/components/ui/Card";
import { type Briefing, requestBriefing } from "@/lib/api/client";
import { type AegisState, runKey } from "@/lib/state/aegisReducer";

interface BriefingCardProps {
  state: AegisState;
  /** Brief the baseline-vs-alternative comparison instead of the single run. */
  includePlan?: boolean;
}

/**
 * A plain-language summary of the run on screen. Gemini writes it from the
 * run's own numbers and the backend checks every number it uses; without AI
 * (or if a number doesn't check out) the backend returns a fixed-sentence summary.
 */
export function BriefingCard({ state, includePlan = false }: BriefingCardProps) {
  const [result, setResult] = useState<{ briefing: Briefing; key: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = `${runKey(state)}|${includePlan}`;
  const briefing = result?.key === key ? result.briefing : null;

  async function generate() {
    if (!state.scenario) return;
    setLoading(true);
    setError(null);
    try {
      const response = await requestBriefing({
        scenarioId: state.scenario.id, randomSeed: state.seed, includePlan, ...state.overrides,
      });
      setResult({ briefing: response, key });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card
      title={includePlan ? "AI briefing: baseline vs alternative" : "AI briefing"}
      actions={
        <button
          type="button"
          onClick={generate}
          disabled={loading || !state.scenario}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          {loading ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Sparkles size={13} aria-hidden />}
          {briefing ? "Regenerate" : "Write briefing"}
        </button>
      }
    >
      {!briefing && !error && (
        <p className="text-sm text-slate-500">
          A short plain-language summary of this run for someone who hasn&apos;t seen the dashboard. Every number in it comes from the
          simulation.
        </p>
      )}
      {briefing && (
        <div role="status">
          <div className="space-y-2 text-sm leading-relaxed text-slate-800">
            {briefing.text.split(/\n\s*\n/).map((paragraph, i) => <p key={i}>{paragraph}</p>)}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            {briefing.source === "gemini"
              ? "Written by Gemini from this run's results; every number was checked against the simulation."
              : "Standard summary generated from this run's results (AI briefing unavailable)."}
          </p>
          {briefing.warnings.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs text-amber-700">
              {briefing.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </Card>
  );
}
