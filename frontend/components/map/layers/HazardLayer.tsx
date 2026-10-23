import { Polygon, Tooltip } from "react-leaflet";

import { HAZARD_COLOR } from "@/lib/map/styling";
import type { HazardZone } from "@/lib/schemas/types";

export function HazardLayer({ hazards }: { hazards: HazardZone[] }) {
  return hazards.map((hazard) => (
    <Polygon
      key={hazard.id}
      positions={hazard.polygon}
      pathOptions={{ color: HAZARD_COLOR, weight: 1, fillOpacity: 0.05 + 0.15 * hazard.severity }}
    >
      <Tooltip sticky>Hazard {hazard.id} · severity {Math.round(hazard.severity * 100)}%</Tooltip>
    </Polygon>
  ));
}
