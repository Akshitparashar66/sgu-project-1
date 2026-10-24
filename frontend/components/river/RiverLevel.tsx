"use client";

import { Waves } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { addRiverReading, fetchRiverStatus, type RiverGauge, type RiverStatus, setRiverThresholds } from "@/lib/api/client";
import type { AegisActions } from "@/lib/state/useAegis";
import { FlowForecast } from "./FlowForecast";

const STATUS_STYLE: Record<RiverGauge["status"], string> = {
  normal: "bg-green-100 text-green-800",
  warning: "bg-amber-100 text-amber-800",
  danger: "bg-red-100 text-red-800",
  "no reading": "bg-slate-100 text-slate-600",
  "thresholds not set": "bg-slate-100 text-slate-600",
};

const input = "w-20 rounded border border-slate-200 px-2 py-1 text-xs tabular-nums focus:border-blue-500 focus:outline-none";

/**
 * River level from a manual reading or a configured feed, checked against the
 * district's own warning and danger levels (never guessed). At warning level
 * or above it offers the matching flood scenario.
 */
export function RiverLevel({ actions }: { actions: AegisActions }) {
  const [status, setStatus] = useState<RiverStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (request?: () => Promise<RiverStatus>) => {
    try {
      setStatus(await (request ?? fetchRiverStatus)());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    // Load once on mount; load() only sets state after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (error) return <section className="text-xs text-red-700">River level unavailable: {error}</section>;
  if (!status) return null;
  return (
    <>
      {status.gauges.map((g) => <Gauge key={g.id} gauge={g} actions={actions} load={load} />)}
      {status.feedError && <p className="text-xs text-amber-700">{status.feedError}</p>}
    </>
  );
}

function Gauge({ gauge: g, actions, load }: { gauge: RiverGauge; actions: AegisActions; load: (r: () => Promise<RiverStatus>) => Promise<void> }) {
  const [level, setLevel] = useState("");
  const [warning, setWarning] = useState(g.warningLevelM?.toString() ?? "");
  const [danger, setDanger] = useState(g.dangerLevelM?.toString() ?? "");

  function submitReading(event: FormEvent) {
    event.preventDefault();
    void load(() => addRiverReading(g.id, Number(level))).then(() => setLevel(""));
  }

  function submitThresholds(event: FormEvent) {
    event.preventDefault();
    void load(() => setRiverThresholds(g.id, Number(warning), Number(danger)));
  }

  return (
    <section aria-label={`${g.name} level`} className="rounded-md border border-slate-200 bg-white p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 font-medium text-slate-800"><Waves size={14} aria-hidden /> {g.river} river level</h2>
        <span className={`rounded px-1.5 py-0.5 ${STATUS_STYLE[g.status]}`}>{g.status}</span>
      </div>
      <p className="mt-1 text-slate-600">
        {g.latest
          ? <>Latest: <strong className="tabular-nums">{g.latest.levelM} m</strong> ({g.latest.source}, {new Date(g.latest.observedAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })})</>
          : "No reading yet."}
        {g.warningLevelM != null && g.dangerLevelM != null && ` · warning ${g.warningLevelM} m, danger ${g.dangerLevelM} m`}
      </p>
      <FlowForecast river={g.river} />
      {g.suggestion && (
        <div role="alert" className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-amber-900">
          {g.suggestion.message}{" "}
          <button type="button" onClick={() => actions.loadScenario(g.suggestion!.scenarioId)} className="font-semibold underline">
            Open it
          </button>
        </div>
      )}
      <form onSubmit={submitReading} className="mt-2 flex items-center gap-1.5">
        <label htmlFor={`level-${g.id}`} className="text-slate-500">Reading (m)</label>
        <input id={`level-${g.id}`} type="number" step="0.01" value={level} onChange={(e) => setLevel(e.target.value)} className={input} />
        <button type="submit" disabled={level === ""} className="rounded border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-100 disabled:opacity-40">Record</button>
      </form>
      <details className="mt-2" open={g.warningLevelM == null}>
        <summary className="cursor-pointer text-slate-500">District thresholds</summary>
        <form onSubmit={submitThresholds} className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <label htmlFor={`warn-${g.id}`} className="text-slate-500">Warning</label>
          <input id={`warn-${g.id}`} type="number" step="0.01" value={warning} onChange={(e) => setWarning(e.target.value)} className={input} />
          <label htmlFor={`danger-${g.id}`} className="text-slate-500">Danger</label>
          <input id={`danger-${g.id}`} type="number" step="0.01" value={danger} onChange={(e) => setDanger(e.target.value)} className={input} />
          <button type="submit" disabled={warning === "" || danger === ""} className="rounded border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-100 disabled:opacity-40">Save</button>
        </form>
        <p className="mt-1 text-slate-500">{g.readingSource} AEGIS doesn&apos;t guess flood levels: use the district&apos;s or CWC&apos;s.</p>
      </details>
    </section>
  );
}
