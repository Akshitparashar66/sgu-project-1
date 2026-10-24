import { Polyline, Tooltip } from "react-leaflet";

import { roadPath } from "@/lib/map/roadPath";
import { ROAD_CASING_COLOR, roadColor, roadDashArray } from "@/lib/map/styling";
import type { RoadEdge } from "@/lib/schemas/types";
import { isSelected, type LayerContext } from "./types";

export function RoadLayer({ edges, congestionByEdgeId, nodeById, selection, onSelect }: LayerContext & {
  edges: RoadEdge[];
  congestionByEdgeId: Record<string, number>;
}) {
  // The detailed network has hundreds of roads: draw them thinner so streets stay readable.
  const dense = edges.length > 50;
  return edges.map((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) return null;
    const ratio = congestionByEdgeId[edge.id] ?? 0;
    // Bottleneck highlighting: badly congested roads thicken, not just redden.
    const weight = (dense ? (ratio > 1.5 ? 4 : 2) : (ratio > 1.5 ? 7 : 4)) + (isSelected(selection, "edge", edge.id) ? 4 : 0);
    const positions = roadPath(edge, source, target);
    return [
      // White casing under each road, as on real road maps: keeps the network
      // legible on every basemap, including satellite imagery.
      <Polyline
        key={`${edge.id}-casing`}
        positions={positions}
        interactive={false}
        pathOptions={{ color: ROAD_CASING_COLOR, weight: weight + (dense ? 2 : 4), opacity: 0.9 }}
      />,
      <Polyline
        key={edge.id}
        positions={positions}
        pathOptions={{ color: roadColor(edge.status, ratio), dashArray: roadDashArray(edge.status), weight }}
        eventHandlers={{ click: () => onSelect?.({ kind: "edge", id: edge.id }) }}
      >
        <Tooltip sticky>
          Road {edge.id} · {edge.status}
          {ratio > 0 ? ` · peak ${ratio.toFixed(1)}× capacity` : ""}
        </Tooltip>
      </Polyline>,
    ];
  });
}
