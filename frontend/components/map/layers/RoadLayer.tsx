import { Polyline, Tooltip } from "react-leaflet";

import { roadColor, roadDashArray } from "@/lib/map/styling";
import type { RoadEdge } from "@/lib/schemas/types";
import { isSelected, type LayerContext } from "./types";

export function RoadLayer({ edges, congestionByEdgeId, nodeById, selection, onSelect }: LayerContext & {
  edges: RoadEdge[];
  congestionByEdgeId: Record<string, number>;
}) {
  return edges.map((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) return null;
    const ratio = congestionByEdgeId[edge.id] ?? 0;
    // Bottleneck highlighting: badly congested roads thicken, not just redden.
    const weight = (ratio > 1.5 ? 7 : 4) + (isSelected(selection, "edge", edge.id) ? 4 : 0);
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
  });
}
