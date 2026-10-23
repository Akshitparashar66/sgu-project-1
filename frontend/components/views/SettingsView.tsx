"use client";

import { useEffect, useState } from "react";

import { Card, Page } from "@/components/ui/Card";
import { API_BASE, fetchHealth } from "@/lib/api/client";
import type { ScenarioConfig } from "@/lib/schemas/types";
import type { AegisState } from "@/lib/state/aegisReducer";
import type { AegisActions } from "@/lib/state/useAegis";

type Health = { state: "checking" } | { state: "ok"; version: string } | { state: "down"; message: string };

export function SettingsView({ state, effectiveScenario: scenario, actions }: {
  state: AegisState; effectiveScenario: ScenarioConfig; actions: AegisActions;
}) {
  const [health, setHealth] = useState<Health>({ state: "checking" });
  const { tickSeconds, maxTicks, randomSeed: defaultSeed } = scenario.defaultParams;

  useEffect(() => {
    fetchHealth()
      .then((h) => setHealth({ state: "ok", version: h.version }))
      .catch((e: unknown) => setHealth({ state: "down", message: e instanceof Error ? e.message : String(e) }));
  }, []);

  return (
    <Page title="Settings" intro="Simulation parameters and system information.">
      <Card title="Reproducibility">
        <label htmlFor="seed" className="text-sm text-slate-300">Random seed</label>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <input
            id="seed"
            type="number"
            value={state.seed}
            onChange={(e) => { if (e.target.value !== "") actions.setSeed(Math.trunc(Number(e.target.value))); }}
            className="w-32 rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm tabular-nums text-slate-100"
          />
          <button
            type="button"
            onClick={() => actions.setSeed(defaultSeed)}
            disabled={state.seed === defaultSeed}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40"
          >
            Use scenario default ({defaultSeed})
          </button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          The seed only decides tie-breaks when evacuees are equally close to two shelters. The same seed and scenario always produce
          an identical run, and the baseline and alternative plans are always computed with the same seed so their comparison is fair.
        </p>
      </Card>

      <Card title="Simulation clock (from the scenario)">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:max-w-md">
          <dt className="text-slate-500">Tick length</dt>
          <dd className="tabular-nums text-slate-200">{tickSeconds} s</dd>
          <dt className="text-slate-500">Time limit</dt>
          <dd className="tabular-nums text-slate-200">{maxTicks} ticks ({Math.round((maxTicks * tickSeconds) / 60)} min)</dd>
        </dl>
      </Card>

      <Card title="Backend">
        <p className="text-sm text-slate-300">
          API at <code className="text-slate-200">{API_BASE}</code>:{" "}
          {health.state === "checking" && <span className="text-slate-400">checking…</span>}
          {health.state === "ok" && <span className="text-green-400">reachable (v{health.version})</span>}
          {health.state === "down" && <span className="text-red-400">not reachable — {health.message}</span>}
        </p>
      </Card>

      <Card title="What this prototype is not">
        <ul className="list-inside list-disc space-y-1 text-sm text-slate-400">
          <li>Not a live emergency-response system — it never issues real evacuation instructions.</li>
          <li>Not validated against real human behavior — speeds and congestion are documented, simplified models.</li>
          <li>Not machine learning — routing is Dijkstra; the alternative plan is a greedy load-balancing heuristic.</li>
          <li>Not connected to any live feed — every scenario is synthetic and loaded from data/scenarios/*.json.</li>
        </ul>
      </Card>
    </Page>
  );
}
