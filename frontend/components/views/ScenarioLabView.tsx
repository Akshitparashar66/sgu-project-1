"use client";

import { FileCheck2, Loader2, Play, Undo2 } from "lucide-react";
import { useState } from "react";

import { InstantEstimate } from "@/components/scenario/InstantEstimate";
import { Card, Page, rowClass, tableClass, theadClass } from "@/components/ui/Card";
import { ApiError, type FieldError, validateScenario, type ValidationSummary } from "@/lib/api/client";
import { hasOverrides } from "@/lib/scenario/overrides";
import type { ScenarioConfig } from "@/lib/schemas/types";
import type { AegisState } from "@/lib/state/aegisReducer";
import type { AegisActions } from "@/lib/state/useAegis";

interface ScenarioLabViewProps {
  state: AegisState;
  effectiveScenario: ScenarioConfig;
  actions: AegisActions;
  onRunComplete: () => void;
}

export function ScenarioLabView({ state, effectiveScenario: scenario, actions, onRunComplete }: ScenarioLabViewProps) {
  const label = (id: string) => scenario.nodes.find((n) => n.id === id)?.label ?? id;

  return (
    <Page
      title="Scenario Lab"
      intro="Close roads or take shelters offline, then run the simulation to see the effect. Changes apply to a copy of the scenario — the scenario file itself is never modified."
      actions={
        <>
          <button
            type="button"
            onClick={actions.clearOverrides}
            disabled={!hasOverrides(state.overrides)}
            className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-40"
          >
            <Undo2 size={15} aria-hidden /> Undo all changes
          </button>
          <button
            type="button"
            onClick={async () => { await actions.run(); onRunComplete(); }}
            disabled={state.busy !== null}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {state.busy === "run" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Play size={15} aria-hidden />}
            Run with these changes
          </button>
        </>
      }
    >
      <InstantEstimate state={state} scenario={scenario} />

      <Card title={`Roads (${scenario.edges.filter((e) => e.status === "closed").length} of ${scenario.edges.length} closed)`}>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th scope="col" className="py-2 font-medium">Road</th>
              <th scope="col" className="py-2 font-medium">Between</th>
              <th scope="col" className="py-2 text-right font-medium">Length</th>
              <th scope="col" className="py-2 text-right font-medium">Capacity / tick</th>
              <th scope="col" className="py-2 text-right font-medium">Hazard</th>
              <th scope="col" className="py-2 pl-4 font-medium">Status</th>
              <th scope="col" className="py-2"><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {scenario.edges.map((edge) => {
              const closed = edge.status === "closed";
              return (
                <tr key={edge.id} className={rowClass}>
                  <th scope="row" className="py-2 font-medium text-slate-800">{edge.id}</th>
                  <td className="py-2 text-slate-500">{label(edge.source)} — {label(edge.target)}</td>
                  <td className="py-2 text-right tabular-nums text-slate-700">{edge.lengthM} m</td>
                  <td className="py-2 text-right tabular-nums text-slate-700">{edge.capacityPerTick}</td>
                  <td className="py-2 text-right tabular-nums text-slate-700">{Math.round(edge.hazardRisk * 100)}%</td>
                  <td className={`py-2 pl-4 ${closed ? "text-red-600" : "text-slate-700"}`}>{edge.status}</td>
                  <td className="py-2 text-right">
                    <ToggleButton danger={!closed} onClick={() => actions.toggleEdge(edge.id)} label={`${closed ? "Reopen" : "Close"} road ${edge.id}`}>
                      {closed ? "Reopen" : "Close"}
                    </ToggleButton>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card title="Shelters">
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th scope="col" className="py-2 font-medium">Shelter</th>
              <th scope="col" className="py-2 font-medium">Name</th>
              <th scope="col" className="py-2 text-right font-medium">Capacity</th>
              <th scope="col" className="py-2 pl-4 font-medium">Status</th>
              <th scope="col" className="py-2"><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {scenario.shelters.map((shelter) => (
              <tr key={shelter.id} className={rowClass}>
                <th scope="row" className="py-2 font-medium text-slate-800">{shelter.id}</th>
                <td className="py-2 text-slate-500">{shelter.name}</td>
                <td className="py-2 text-right tabular-nums text-slate-700">{shelter.totalCapacity}</td>
                <td className={`py-2 pl-4 ${shelter.available ? "text-slate-700" : "text-red-600"}`}>
                  {shelter.available ? "available" : "unavailable"}
                </td>
                <td className="py-2 text-right">
                  <ToggleButton
                    danger={shelter.available}
                    onClick={() => actions.toggleShelter(shelter.id)}
                    label={`Mark shelter ${shelter.id} ${shelter.available ? "unavailable" : "available"}`}
                  >
                    {shelter.available ? "Take offline" : "Bring online"}
                  </ToggleButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Population zones">
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th scope="col" className="py-2 font-medium">Zone</th>
              <th scope="col" className="py-2 font-medium">Name</th>
              <th scope="col" className="py-2 text-right font-medium">Evacuees</th>
              <th scope="col" className="py-2 pl-4 font-medium">Mobility mix</th>
            </tr>
          </thead>
          <tbody>
            {scenario.zones.map((zone) => (
              <tr key={zone.id} className={rowClass}>
                <th scope="row" className="py-2 font-medium text-slate-800">{zone.id}</th>
                <td className="py-2 text-slate-500">{zone.name}</td>
                <td className="py-2 text-right tabular-nums text-slate-700">{zone.evacueeCount}</td>
                <td className="py-2 pl-4 text-slate-500">
                  {Object.entries(zone.movementProfile).map(([p, share]) => `${p.replace(/_/g, " ")} ${Math.round(share * 100)}%`).join(" · ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <ScenarioFileValidator />
    </Page>
  );
}

function ToggleButton({ danger, onClick, label, children }: { danger: boolean; onClick: () => void; label: string; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`rounded-md border px-2.5 py-1 text-xs font-medium ${danger ? "border-red-200 text-red-700 hover:bg-red-50" : "border-green-200 text-green-800 hover:bg-green-50"}`}
    >
      {children}
    </button>
  );
}

/** PRD §10.4: check a scenario JSON file against the same rules the backend loads with. */
function ScenarioFileValidator() {
  const [result, setResult] = useState<ValidationSummary | null>(null);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  async function validate(file: File) {
    setResult(null);
    setErrors([]);
    setMessage(null);
    let body: unknown;
    try {
      body = JSON.parse(await file.text());
    } catch {
      setMessage(`${file.name} is not valid JSON.`);
      return;
    }
    try {
      setResult(await validateScenario(body));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      if (error instanceof ApiError) setErrors(error.errors);
    }
  }

  return (
    <Card title="Validate a scenario file">
      <p className="mb-3 text-sm text-slate-500">
        Check a scenario JSON (same format as <code className="text-slate-700">data/scenarios/*.json</code>) for shape errors and broken
        references before adding it to the scenario folder. Nothing is saved or run.
      </p>
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
        <FileCheck2 size={15} aria-hidden />
        Choose scenario file…
        <input
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={(e) => { const file = e.target.files?.[0]; if (file) void validate(file); e.target.value = ""; }}
        />
      </label>
      {result && (
        <p role="status" className="mt-3 rounded-md border border-green-200 bg-green-50/60 p-3 text-sm text-green-800">
          Valid: <strong>{result.scenarioId}</strong> — {result.summary.nodes} nodes, {result.summary.edges} roads, {result.summary.zones} zones
          ({result.summary.evacuees} evacuees), {result.summary.shelters} shelters ({result.summary.shelterCapacity} places).
        </p>
      )}
      {message && (
        <div role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50/60 p-3 text-sm text-red-700">
          <p>{message}</p>
          {errors.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs">
              {errors.map((e, i) => <li key={i}><code className="text-red-700">{e.field ?? "(file)"}</code> — {e.message}</li>)}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
