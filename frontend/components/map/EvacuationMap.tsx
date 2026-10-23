"use client";

import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer, Tooltip } from "react-leaflet";

import { clusterRadius, clusterResolvedAgents } from "@/lib/map/agentClusters";
import { agentMarkerColor, roadColor, roadDashArray, shelterFillColor } from "@/lib/map/styling";
import type { AgentResult, ScenarioConfig } from "@/lib/schemas/types";
import { Legend } from "./Legend";

export type MapSelection = { kind: "edge" | "shelter" | "zone"; id: string } | null;

interface EvacuationMapProps {
  scenario: ScenarioConfig;
  congestionByEdgeId?: Record<string, number>;
  agents?: AgentResult[];
  /** Live shelter occupancy (from a run); falls back to the scenario's own `occupied`. */
  occupancyByShelterId?: Record<string, number>;
  selection?: MapSelection;
  onSelect?: (selection: MapSelection) => void;
}

export function EvacuationMap({
  scenario, congestionByEdgeId = {}, agents = [], occupancyByShelterId, selection = null, onSelect,
}: EvacuationMapProps) {
  const nodeById = new Map(scenario.nodes.map((n) => [n.id, n]));
  const lats = scenario.nodes.map((n) => n.lat);
  const lons = scenario.nodes.map((n) => n.lon);
  const bounds: [[number, number], [number, number]] = scenario.nodes.length
    ? [[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]]
    : [[0, 0], [0, 0]];
  const isSelected = (kind: string, id: string) => selection?.kind === kind && selection.id === id;

  return (
    <div className="relative h-full w-full">
      <MapContainer bounds={bounds} boundsOptions={{ padding: [48, 48] }} className="h-full w-full bg-slate-950">
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />

        {scenario.hazards.map((hazard) => (
          <Polygon
            key={hazard.id}
            positions={hazard.polygon}
            pathOptions={{ color: "#ef4444", weight: 1, fillOpacity: 0.05 + 0.15 * hazard.severity }}
          >
            <Tooltip sticky>Hazard {hazard.id} · severity {Math.round(hazard.severity * 100)}%</Tooltip>
          </Polygon>
        ))}

        {scenario.edges.map((edge) => {
          const source = nodeById.get(edge.source);
          const target = nodeById.get(edge.target);
          if (!source || !target) return null;
          const ratio = congestionByEdgeId[edge.id] ?? 0;
          // Bottleneck highlighting: badly congested roads thicken, not just redden.
          const weight = (ratio > 1.5 ? 7 : 4) + (isSelected("edge", edge.id) ? 4 : 0);
          return (
            <Polyline
              key={edge.id}
              positions={[[source.lat, source.lon], [target.lat, target.lon]]}
              pathOptions={{ color: roadColor(edge.status, ratio), dashArray: roadDashArray(edge.status), weight }}
              eventHandlers={{ click: () => onSelect?.({ kind: "edge", id: edge.id }) }}
            >
              <Tooltip sticky>
                Road {edge.id} · {edge.status}
                {ratio > 0 ? ` · peak ${ratio.toFixed(1)}× capacity` : ""}
              </Tooltip>
            </Polyline>
          );
        })}

        {/* Agent clusters render under shelters/zones, so they read as a halo sized by headcount. */}
        {clusterResolvedAgents(scenario, agents).map((cluster) => {
          const node = nodeById.get(cluster.nodeId);
          if (!node) return null;
          return (
            <CircleMarker
              key={cluster.key}
              center={[node.lat, node.lon]}
              radius={clusterRadius(cluster.count)}
              pathOptions={{ color: agentMarkerColor(cluster.status), weight: 1, fillOpacity: 0.3 }}
            >
              <Tooltip>{cluster.count} agents {cluster.status}</Tooltip>
            </CircleMarker>
          );
        })}

        {scenario.shelters.map((shelter) => {
          const node = nodeById.get(shelter.connectorNode);
          if (!node) return null;
          const occupied = occupancyByShelterId?.[shelter.id] ?? shelter.occupied;
          const color = shelter.available ? shelterFillColor(occupied, shelter.totalCapacity) : "#64748b";
          return (
            <CircleMarker
              key={shelter.id}
              center={[node.lat, node.lon]}
              radius={isSelected("shelter", shelter.id) ? 13 : 10}
              pathOptions={{ color: isSelected("shelter", shelter.id) ? "#f8fafc" : color, fillColor: color, fillOpacity: 0.85 }}
              eventHandlers={{ click: () => onSelect?.({ kind: "shelter", id: shelter.id }) }}
            >
              <Tooltip>
                {shelter.name} · {occupied}/{shelter.totalCapacity}
                {shelter.available ? "" : " · unavailable"}
              </Tooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
      <Legend />
    </div>
  );
}
