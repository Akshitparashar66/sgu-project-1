import { CircleMarker, Tooltip } from "react-leaflet";

import { shelterFillColor, UNAVAILABLE_COLOR } from "@/lib/map/styling";
import type { Shelter } from "@/lib/schemas/types";
import { isSelected, type LayerContext } from "./types";

export function ShelterLayer({ shelters, occupancyByShelterId, nodeById, selection, onSelect }: LayerContext & {
  shelters: Shelter[];
  occupancyByShelterId?: Record<string, number>;
}) {
  return shelters.map((shelter) => {
    const node = nodeById.get(shelter.connectorNode);
    if (!node) return null;
    const occupied = occupancyByShelterId?.[shelter.id] ?? shelter.occupied;
    const color = shelter.available ? shelterFillColor(occupied, shelter.totalCapacity) : UNAVAILABLE_COLOR;
    const selected = isSelected(selection, "shelter", shelter.id);
    return (
      <CircleMarker
        key={shelter.id}
        center={[node.lat, node.lon]}
        radius={selected ? 13 : 10}
        pathOptions={{ color: selected ? "#0f172a" : color, fillColor: color, fillOpacity: 0.85 }}
        eventHandlers={{ click: () => onSelect?.({ kind: "shelter", id: shelter.id }) }}
      >
        <Tooltip direction="right" permanent className="aegis-label">
          {shelter.id} {shelter.name} · {occupied}/{shelter.totalCapacity}
          {shelter.available ? "" : shelter.standby ? " · standby" : " · unavailable"}
        </Tooltip>
      </CircleMarker>
    );
  });
}
