"use client";

import { FileCheck2, Loader2, Play, Undo2 } from "lucide-react";
import { useState } from "react";

import { AppliedAlerts } from "@/components/alerts/AppliedAlerts";
import { ImportData } from "@/components/scenario/ImportData";
import { InstantEstimate } from "@/components/scenario/InstantEstimate";
import { WeakPoints } from "@/components/scenario/WeakPoints";
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

// A jammed road keeps this share of its capacity (what a live traffic alert applies).
const CAPACITY_CHOICES = [1, 0.75, 0.5, 0.25];

// Above this many roads (the detailed network), the table shows a search box and the first matches.
const ROAD_TABLE_LIMIT = 25;

export function ScenarioLabView({ state, effectiveScenario: scenario, actions, onRunComplete }: ScenarioLabViewProps) {
  const label = (id: string) => scenario.nodes.find((n) => n.id === id)?.label ?? id;
  const [roadQuery, setRoadQuery] = useState("");
  const manyRoads = scenario.edges.length > ROAD_TABLE_LIMIT;
  const query = roadQuery.trim().toLowerCase();
  const matching = manyRoads
    ? scenario.edges
        .filter((e) => !query || `${e.id} ${label(e.source)} ${label(e.target)}`.toLowerCase().includes(query))
        // Closed and soon-to-flood roads first, so changes are never hidden.
        .sort((a, b) => Number(b.status === "closed" || b.closesAtTick != null) - Number(a.status === "closed" || a.closesAtTick != null))
    : scenario.edges;
  const shownRoads = matching.slice(0, manyRoads ? ROAD_TABLE_LIMIT : matching.length);

  return (
    <Page
      title="Scenario Lab"
      intro="Close roads, slow them down or take shelters offline, then run the simulation to see the effect. Changes apply to a copy of the scenario — the scenario file itself is never modified."
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
      <AppliedAlerts state={state} />

      <InstantEstimate state={state} scenario={scenario} />

      <WeakPoints state={state} actions={actions} />

      <Card title={`Roads (${scenario.edges.filter((e) => e.status === "closed").length} of ${scenario.edges.length} closed)`}>
        {manyRoads && (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <label htmlFor="road-search" className="sr-only">Find a road</label>
            <input
              id="road-search"
              value={roadQuery}
              onChange={(e) => setRoadQuery(e.target.value)}
              placeholder="Find a road by id or street name"
              className="min-w-0 flex-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            />
            <span className="text-xs text-slate-500">
              Showing {shownRoads.length} of {matching.length} matching roads ({scenario.edges.length} in total)
            </span>
          </div>
        )}
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th scope="col" className="py-2 pr-3 font-medium">Road</th>
              <th scope="col" className="py-2 font-medium">Between</th>
              <th scope="col" className="py-2 pl-3 text-right font-medium">Length</th>
              <th scope="col" className="py-2 pl-3 text-right font-medium">Capacity / tick</th>
              <th scope="col" className="py-2 pl-3 text-right font-medium">Hazard</th>
              <th scope="col" className="py-2 pl-4 font-medium">Status</th>
              <th scope="col" className="py-2 pl-3 font-medium">Flow</th>
              <th scope="col" className="py-2"><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {shownRoads.map((edge) => {
              const closed = edge.status === "closed";
              const factor = state.overrides.edgeCapacityFactors[edge.id] ?? 1;
              return (
                <tr key={edge.id} className={rowClass}>
                  <th scope="row" className="py-2 pr-3 font-medium text-slate-800">{edge.id}</th>
                  <td className="py-2 text-slate-500">{label(edge.source)} — {label(edge.target)}</td>
                  <td className="whitespace-nowrap py-2 pl-3 text-right tabular-nums text-slate-700">{edge.lengthM} m</td>
                  <td className={`py-2 pl-3 text-right tabular-nums ${factor < 1 ? "font-medium text-amber-700" : "text-slate-700"}`}>
                    {edge.capacityPerTick}
                  </td>
                  <td className="py-2 pl-3 text-right tabular-nums text-slate-700">{Math.round(edge.hazardRisk * 100)}%</td>
                  <td className={`py-2 pl-4 ${closed ? "text-red-600" : "text-slate-700"}`}>
                    {edge.status}
                    {!closed && edge.closesAtTick != null && (
                      <span className="block text-xs text-amber-700">floods at {(edge.closesAtTick * scenario.defaultParams.tickSeconds) / 60} min</span>
                    )}
                  </td>
                  <td className="py-2 pl-3">
                    {!closed && (
                      <select
                        aria-label={`Usable capacity of road ${edge.id}`}
                        value={factor}
                        onChange={(e) => actions.setEdgeCapacity(edge.id, Number(e.target.value))}
                        className="rounded border border-slate-200 px-1 py-0.5 text-xs text-slate-700"
                      >
                        {CAPACITY_CHOICES.map((c) => <option key={c} value={c}>{c === 1 ? "Full" : `${c * 100}%`}</option>)}
                      </select>
                    )}
                  </td>
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
                  {shelter.available ? "available" : shelter.standby ? "standby" : "unavailable"}
                  {shelter.available && (shelter.opensAtTick ?? 0) > 0 && (
                    <span className="block text-xs text-amber-700">opens at {((shelter.opensAtTick ?? 0) * scenario.defaultParams.tickSeconds) / 60} min</span>
                  )}
                  {shelter.available && shelter.intakePerTick != null && (
                    <span className="block text-xs text-slate-500">
                      registers {Math.round(shelter.intakePerTick * 60 / scenario.defaultParams.tickSeconds)} people/min
                    </span>
                  )}
                </td>
                <td className="py-2 text-right">
                  {shelter.standby && !shelter.available ? (
                    <span className="text-xs text-slate-500">the optimizer may open it</span>
                  ) : (
                    <ToggleButton
                      danger={shelter.available}
                      onClick={() => actions.toggleShelter(shelter.id)}
                      label={`Mark shelter ${shelter.id} ${shelter.available ? "unavailable" : "available"}`}
                    >
                      {shelter.available ? "Take offline" : "Bring online"}
                    </ToggleButton>
                  )}
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

      <ImportData scenario={scenario} actions={actions} />

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
