"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";

import type { MapSelection } from "@/components/map/layers/types";
import { formatOccupancy } from "@/lib/metrics/format";
import type { RunResult, ScenarioConfig } from "@/lib/schemas/types";

interface InspectorProps {
  scenario: ScenarioConfig;
  selection: MapSelection;
  run: RunResult | null;
  onToggleEdge: (edgeId: string) => void;
  onToggleShelter: (shelterId: string) => void;
  onClose: () => void;
}

/** PRD §4.2.D: details for the selected road / shelter / zone, plus its what-if action. */
export function Inspector({ scenario, selection, run, onToggleEdge, onToggleShelter, onClose }: InspectorProps) {
  if (!selection) return null;
  const nodeLabel = (id: string) => scenario.nodes.find((n) => n.id === id)?.label ?? id;

  let title: ReactNode = null;
  let body: ReactNode = null;

  if (selection.kind === "edge") {
    const edge = scenario.edges.find((e) => e.id === selection.id);
    if (!edge) return null;
    const congestion = run?.congestion.find((c) => c.edgeId === edge.id);
    const routed = run?.agents.filter((a) => a.routeEdgeIds.includes(edge.id)).length;
    const closed = edge.status === "closed";
    title = `Road ${edge.id}`;
    body = (
      <>
        <p className="mb-2 text-slate-700">{nodeLabel(edge.source)} → {nodeLabel(edge.target)}</p>
        <Facts rows={[
          ["Status", edge.status],
          ["Length", `${edge.lengthM} m`],
          ["Capacity", `${edge.capacityPerTick} / tick`],
          ["Free-flow time", `${edge.baseTravelTimeS} s`],
          ["Hazard risk", `${Math.round(edge.hazardRisk * 100)}%`],
          ...(run ? [
            ["Peak congestion", congestion ? `${congestion.peakDemandToCapacity.toFixed(2)}× at tick ${congestion.peakTick}` : "unused"],
            ["Congestion delay", congestion ? `${(congestion.totalDelayS / 3600).toFixed(1)} agent-h` : "—"],
            ["Evacuees routed", String(routed)],
          ] as [string, string][] : []),
        ]} />
        <ActionButton tone={closed ? "restore" : "danger"} onClick={() => onToggleEdge(edge.id)}>
          {closed ? "Reopen road" : "Close road"}
        </ActionButton>
      </>
    );
  } else if (selection.kind === "shelter") {
    const shelter = scenario.shelters.find((s) => s.id === selection.id);
    if (!shelter) return null;
    const result = run?.shelters.find((s) => s.shelterId === shelter.id);
    title = `${shelter.id} · ${shelter.name}`;
    body = (
      <>
        <Facts rows={[
          ["Status", shelter.available ? "available" : "unavailable"],
          ["Capacity", String(shelter.totalCapacity)],
          ...(result ? [
            ["Occupancy", formatOccupancy(result.finalOccupied, result.totalCapacity)],
            ["Turned away", String(result.rejectedCount)],
          ] as [string, string][] : []),
        ]} />
        <ActionButton tone={shelter.available ? "danger" : "restore"} onClick={() => onToggleShelter(shelter.id)}>
          {shelter.available ? "Mark unavailable" : "Mark available"}
        </ActionButton>
      </>
    );
  } else {
    const zone = scenario.zones.find((z) => z.id === selection.id);
    if (!zone) return null;
    const zoneAgents = run?.agents.filter((a) => a.originZone === zone.id) ?? [];
    const destinations = new Map<string, number>();
    for (const a of zoneAgents) {
      if (a.status === "arrived" && a.assignedShelter) {
        destinations.set(a.assignedShelter, (destinations.get(a.assignedShelter) ?? 0) + 1);
      }
    }
    const unserved = zoneAgents.filter((a) => a.status === "unserved").length;
    title = `${zone.id} · ${zone.name}`;
    body = (
      <>
        <Facts rows={[["Evacuees", String(zone.evacueeCount)], ["Leaves via", nodeLabel(zone.connectorNode)]]} />
        <h4 className="mt-3 text-xs uppercase tracking-wide text-slate-500">Population mix</h4>
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {Object.entries(zone.movementProfile).map(([profile, share]) => (
            <li key={profile} className="rounded bg-slate-100 px-2 py-0.5">{profile.replace(/_/g, " ")} {Math.round(share * 100)}%</li>
          ))}
        </ul>
        {run && (
          <>
            <h4 className="mt-3 text-xs uppercase tracking-wide text-slate-500">Where they went</h4>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {[...destinations.entries()].map(([shelterId, count]) => (
                <li key={shelterId} className="rounded bg-green-50 px-2 py-0.5 text-green-800">{shelterId}: {count}</li>
              ))}
              {unserved > 0 && <li className="rounded bg-red-50 px-2 py-0.5 text-red-700">unserved: {unserved}</li>}
            </ul>
          </>
        )}
      </>
    );
  }

  return (
    <section aria-label="Inspector" className="w-72 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-800">
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="font-semibold text-slate-900">{title}</h3>
        <button type="button" onClick={onClose} aria-label="Close inspector" className="rounded p-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900">
          <X size={16} aria-hidden />
        </button>
      </div>
      {body}
    </section>
  );
}

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-slate-500">{label}</dt>
          <dd className="tabular-nums text-slate-800">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ActionButton({ tone, onClick, children }: { tone: "danger" | "restore"; onClick: () => void; children: ReactNode }) {
  const toneClass = tone === "danger"
    ? "border-red-200 text-red-700 hover:bg-red-50"
    : "border-green-200 text-green-800 hover:bg-green-50";
  return (
    <button type="button" onClick={onClick} className={`mt-3 w-full rounded-md border px-3 py-1.5 text-sm font-medium ${toneClass}`}>
      {children}
    </button>
  );
}
