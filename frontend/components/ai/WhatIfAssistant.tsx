"use client";

import { Check, Loader2, Sparkles, X } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Card } from "@/components/ui/Card";
import { interpretWhatIf, type WhatIfProposal } from "@/lib/api/client";
import type { ScenarioConfig } from "@/lib/schemas/types";
import type { AegisState } from "@/lib/state/aegisReducer";
import type { AegisActions } from "@/lib/state/useAegis";

const EXAMPLE = "What if the Gaur Cascades Rd link floods and the school camp can't open?";

interface WhatIfAssistantProps {
  state: AegisState;
  scenario: ScenarioConfig;
  actions: AegisActions;
}

/**
 * Type a what-if question; Gemini maps it to road and shelter changes from
 * this scenario. Nothing changes until the planner applies the proposal,
 * and the numbers still come only from running the simulation.
 */
export function WhatIfAssistant({ state, scenario, actions }: WhatIfAssistantProps) {
  const [question, setQuestion] = useState("");
  const [proposal, setProposal] = useState<WhatIfProposal | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!state.scenario || !question.trim()) return;
    setLoading(true);
    setError(null);
    setProposal(null);
    try {
      setProposal(await interpretWhatIf({ scenarioId: state.scenario.id, question: question.trim(), ...state.overrides }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const label = (id: string) => scenario.nodes.find((n) => n.id === id)?.label ?? id;
  const road = (id: string) => {
    const edge = scenario.edges.find((e) => e.id === id);
    return edge ? `Road ${id} (${label(edge.source)} — ${label(edge.target)})` : `Road ${id}`;
  };
  const shelter = (id: string) => `${scenario.shelters.find((s) => s.id === id)?.name ?? "Shelter"} (${id})`;

  const changes = proposal
    ? [
        ...proposal.closeEdgeIds.map((id) => `Close ${road(id)}`),
        ...proposal.reopenEdgeIds.map((id) => `Reopen ${road(id)}`),
        ...proposal.unavailableShelterIds.map((id) => `Take ${shelter(id)} offline`),
        ...proposal.restoreShelterIds.map((id) => `Bring ${shelter(id)} back online`),
      ]
    : [];

  return (
    <Card title="Ask a what-if">
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="what-if-question" className="sr-only">What-if question</label>
        <input
          id="what-if-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={500}
          placeholder={EXAMPLE}
          className="min-w-0 flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          {loading ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Sparkles size={15} aria-hidden />}
          Interpret
        </button>
      </form>
      <p className="mt-2 text-xs text-slate-500">
        Describe closures or lost shelters in your own words. You&apos;ll see the proposed changes before anything is applied.
      </p>

      {proposal && (
        <div role="status" className="mt-4 rounded-md border border-slate-200 bg-slate-50/60 p-3 text-sm">
          <p className="text-slate-700">{proposal.interpretation}</p>
          {changes.length > 0 ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-slate-800">
              {changes.map((c) => <li key={c}>{c}</li>)}
            </ul>
          ) : (
            <p className="mt-2 text-slate-500">No road or shelter changes matched this question.</p>
          )}
          {proposal.unmatched.length > 0 && (
            <p className="mt-2 text-xs text-slate-600">
              Not something the simulator can change: {proposal.unmatched.join("; ")}
            </p>
          )}
          {proposal.warnings.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-amber-700">
              {proposal.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          <p className="mt-2 text-xs text-slate-500">
            {proposal.source === "gemini" ? "Interpreted by Gemini." : "Matched by keyword (AI unavailable)."}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={changes.length === 0}
              onClick={() => { actions.applyChanges(proposal); setProposal(null); setQuestion(""); }}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
            >
              <Check size={13} aria-hidden /> Apply these changes
            </button>
            <button
              type="button"
              onClick={() => setProposal(null)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
            >
              <X size={13} aria-hidden /> Discard
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </Card>
  );
}
