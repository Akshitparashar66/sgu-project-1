"use client";

import { Download, Loader2, Upload } from "lucide-react";
import { useState } from "react";

import { Card } from "@/components/ui/Card";
import { ApiError, type FieldError, importScenario, type ImportResult } from "@/lib/api/client";
import type { ScenarioConfig } from "@/lib/schemas/types";
import type { AegisActions } from "@/lib/state/useAegis";

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

/** The scenario's own zones and shelters in the import format, as a starting template. */
export function templates(scenario: ScenarioConfig): { zones: string; shelters: string } {
  const node = (id: string) => scenario.nodes.find((n) => n.id === id);
  const zones = scenario.zones.map((z) => {
    const total = Object.values(z.movementProfile).reduce((a, b) => a + b, 0) || 1;
    const slow = Math.round(((z.movementProfile.reduced_mobility ?? 0) / total) * 100);
    return [z.name, z.evacueeCount, node(z.connectorNode)?.lat ?? "", node(z.connectorNode)?.lon ?? "", slow];
  });
  const shelters = scenario.shelters.map((s) => [s.name, s.totalCapacity, node(s.connectorNode)?.lat ?? "", node(s.connectorNode)?.lon ?? ""]);
  return {
    zones: toCsv([["name", "population", "lat", "lon", "reduced_mobility_share"], ...zones]),
    shelters: toCsv([["name", "capacity", "lat", "lon"], ...shelters]),
  };
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Bring a district's own wards and shelters (e.g. from its Disaster
 * Management Plan) onto this scenario's street network. The result is saved
 * as a new scenario; the shipped ones are never changed.
 */
export function ImportData({ scenario, actions }: { scenario: ScenarioConfig; actions: AegisActions }) {
  const [name, setName] = useState("My district data");
  const [zones, setZones] = useState<File | null>(null);
  const [shelters, setShelters] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldError[]>([]);

  async function submit() {
    setBusy(true);
    setResult(null);
    setError(null);
    setErrors([]);
    try {
      const imported = await importScenario({
        baseScenarioId: scenario.id, name: name.trim(),
        zonesCsv: zones ? await zones.text() : undefined,
        sheltersCsv: shelters ? await shelters.text() : undefined,
      });
      setResult(imported);
      await actions.openScenario(imported.scenarioId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (e instanceof ApiError) setErrors(e.errors);
    } finally {
      setBusy(false);
    }
  }

  const csv = templates(scenario);
  const fileInput = (label: string, file: File | null, set: (f: File | null) => void) => (
    <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
      <Upload size={15} aria-hidden />
      <span className="truncate">{file ? file.name : label}</span>
      <input type="file" accept=".csv,text/csv" className="sr-only" aria-label={label} onChange={(e) => set(e.target.files?.[0] ?? null)} />
    </label>
  );

  return (
    <Card title="Use your own data">
      <p className="mb-3 text-sm text-slate-500">
        Upload your wards (name, population, lat, lon, optional reduced_mobility_share) and/or shelters (name, capacity, lat,
        lon) as CSV, for example from the district disaster management plan. They are placed on this scenario&apos;s street network,
        each at its nearest road junction, and saved as a new scenario. Leave a file out to keep this scenario&apos;s version.
      </p>
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        <button type="button" onClick={() => download("zones.csv", csv.zones)} className="inline-flex items-center gap-1.5 text-blue-700 hover:underline">
          <Download size={13} aria-hidden /> Current zones as a template
        </button>
        <button type="button" onClick={() => download("shelters.csv", csv.shelters)} className="inline-flex items-center gap-1.5 text-blue-700 hover:underline">
          <Download size={13} aria-hidden /> Current shelters as a template
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Scenario name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
          />
        </label>
        <div className="flex flex-col justify-end">{fileInput("Zones CSV", zones, setZones)}</div>
        <div className="flex flex-col justify-end">{fileInput("Shelters CSV", shelters, setShelters)}</div>
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={busy || !name.trim() || (!zones && !shelters)}
        className="mt-3 inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {busy && <Loader2 size={15} className="animate-spin" aria-hidden />} Import and open
      </button>

      {result && (
        <div role="status" className="mt-3 rounded-md border border-green-200 bg-green-50/60 p-3 text-sm text-green-800">
          <p>
            Opened <strong>{name.trim()}</strong>: {result.summary.zones} zones ({result.summary.evacuees.toLocaleString()} evacuees),{" "}
            {result.summary.shelters} shelters ({result.summary.shelterCapacity.toLocaleString()} places).
          </p>
          {result.warnings.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-amber-700">
              {result.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
        </div>
      )}
      {error && (
        <div role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50/60 p-3 text-sm text-red-700">
          <p>{error}</p>
          {errors.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs">
              {errors.map((e, i) => <li key={i}><code>{e.field ?? "(file)"}</code> — {e.message}</li>)}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
