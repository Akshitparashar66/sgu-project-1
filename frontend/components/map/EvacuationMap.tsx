"use client";

import type { FitBoundsOptions } from "leaflet";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { MapContainer } from "react-leaflet";

import type { AgentResult, ScenarioConfig } from "@/lib/schemas/types";
import { Basemaps } from "./Basemaps";
import { FitToBounds } from "./FitToBounds";
import { AgentClusterLayer } from "./layers/AgentClusterLayer";
import { HazardLayer } from "./layers/HazardLayer";
import { RoadLayer } from "./layers/RoadLayer";
import { ShelterLayer } from "./layers/ShelterLayer";
import type { MapSelection } from "./layers/types";
import { ZoneLayer } from "./layers/ZoneLayer";
import { Legend } from "./Legend";

export type { MapSelection } from "./layers/types";

// Room for zone labels (centred under the lowest/leftmost nodes, ~50 px below
// the node) and shelter labels (drawn to the right). The legend's own height
// is measured and added at the bottom, since it wraps on narrower maps.
const LABEL_ALLOWANCE_PX = 60;
const LEGEND_OFFSET_PX = 24; // the legend sits bottom-6

function fitOptions(legendHeight: number): FitBoundsOptions {
  return { paddingTopLeft: [110, 50], paddingBottomRight: [200, legendHeight + LEGEND_OFFSET_PX + LABEL_ALLOWANCE_PX] };
}

export interface EvacuationMapProps {
  scenario: ScenarioConfig;
  congestionByEdgeId?: Record<string, number>;
  agents?: AgentResult[];
  /** Live shelter occupancy (from a run); falls back to the scenario's own `occupied`. */
  occupancyByShelterId?: Record<string, number>;
  selection?: MapSelection;
  onSelect?: (selection: MapSelection) => void;
  /** Extra react-leaflet layers drawn above roads (e.g. the replay's moving agents). */
  children?: ReactNode;
}

export function EvacuationMap({
  scenario, congestionByEdgeId = {}, agents = [], occupancyByShelterId, selection = null, onSelect, children,
}: EvacuationMapProps) {
  const nodeById = new Map(scenario.nodes.map((n) => [n.id, n]));
  // Fit nodes and the street paths between them: a road can bend outside its junctions.
  const points = [...scenario.nodes.map((n) => [n.lat, n.lon]), ...scenario.edges.flatMap((e) => e.geometry ?? [])];
  const lats = points.map((p) => p[0]);
  const lons = points.map((p) => p[1]);
  const bounds: [[number, number], [number, number]] = scenario.nodes.length
    ? [[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]]
    : [[0, 0], [0, 0]];
  const context = { nodeById, selection, onSelect };

  const legendRef = useRef<HTMLDivElement>(null);
  const [legendHeight, setLegendHeight] = useState(50);
  useEffect(() => {
    const legend = legendRef.current;
    if (!legend) return;
    const observer = new ResizeObserver(() => setLegendHeight(legend.offsetHeight));
    observer.observe(legend);
    return () => observer.disconnect();
  }, []);
  const fit = fitOptions(legendHeight);

  return (
    <div className="relative h-full w-full">
      {/* zoomSnap 0.25: whole-level zoom steps leave the small network tiny after a refit. */}
      <MapContainer bounds={bounds} boundsOptions={fit} zoomSnap={0.25} className="h-full w-full bg-slate-50">
        <FitToBounds bounds={bounds} options={fit} />
        <Basemaps />
        <HazardLayer hazards={scenario.hazards} />
        <RoadLayer edges={scenario.edges} congestionByEdgeId={congestionByEdgeId} {...context} />
        {/* Agent clusters render under shelters/zones, so they read as a halo sized by headcount. */}
        <AgentClusterLayer scenario={scenario} agents={agents} nodeById={nodeById} />
        {children}
        <ZoneLayer zones={scenario.zones} {...context} />
        <ShelterLayer shelters={scenario.shelters} occupancyByShelterId={occupancyByShelterId} {...context} />
      </MapContainer>
      <p className="pointer-events-none absolute left-16 top-3 z-[1000] rounded-md bg-white/90 px-2 py-1 text-[11px] text-slate-500">
        Roads follow real streets (OpenStreetMap) ·{" "}
        {scenario.synthetic ? "people, shelters and capacities are synthetic" : "people and shelters from uploaded data"}
      </p>
      <Legend ref={legendRef} />
    </div>
  );
}
