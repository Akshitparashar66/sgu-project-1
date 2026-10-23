import { CircleMarker, Tooltip } from "react-leaflet";

import { clusterRadius } from "@/lib/map/agentClusters";
import { ZONE_COLOR } from "@/lib/map/styling";
import type { PopulationZone } from "@/lib/schemas/types";
import { isSelected, type LayerContext } from "./types";

export function ZoneLayer({ zones, nodeById, selection, onSelect }: LayerContext & { zones: PopulationZone[] }) {
  return zones.map((zone) => {
    const node = nodeById.get(zone.connectorNode);
    if (!node) return null;
    const selected = isSelected(selection, "zone", zone.id);
    return (
      <CircleMarker
        key={zone.id}
        center={[node.lat, node.lon]}
        // Hollow ring sized like an agent cluster of the same headcount, so
        // "people who left" and "people who were here" compare by eye.
        radius={clusterRadius(zone.evacueeCount)}
        pathOptions={{ color: selected ? "#0f172a" : ZONE_COLOR, weight: selected ? 3 : 2, fillOpacity: 0.08 }}
        eventHandlers={{ click: () => onSelect?.({ kind: "zone", id: zone.id }) }}
      >
        <Tooltip direction="bottom" offset={[0, clusterRadius(zone.evacueeCount)]} permanent className="aegis-label">
          {zone.name} · {zone.evacueeCount} evacuees
        </Tooltip>
      </CircleMarker>
    );
  });
}
