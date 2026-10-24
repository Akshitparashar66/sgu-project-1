import { Polygon, Polyline, Tooltip } from "react-leaflet";

import { roadConditions } from "@/lib/alerts/alerts";
import type { AlertsOverview } from "@/lib/api/client";
import { roadPath } from "@/lib/map/roadPath";
import type { HazardZone, RoadEdge } from "@/lib/schemas/types";
import type { LayerContext } from "./types";

const ALERT_COLOR = { extreme: "#b91c1c", severe: "#dc2626", warning: "#d97706", info: "#64748b" } as const;

/**
 * Live alerts drawn on the map: a pulsing outline on roads with a traffic
 * alert, and the flood hazard area outlined while a river alert is open.
 * Official alerts have no reliable shape, so they appear in the map badge.
 */
export function AlertLayer({ overview, edges, hazards, nodeById, onSelect }: Pick<LayerContext, "nodeById" | "onSelect"> & {
  overview: AlertsOverview | null;
  edges: RoadEdge[];
  hazards: HazardZone[];
}) {
  const roads = roadConditions(overview);
  const river = overview?.alerts.find((a) => a.marksHazard && a.status !== "expired");
  return (
    <>
      {river && hazards.map((hazard) => (
        <Polygon
          key={`alert-${hazard.id}`}
          positions={hazard.polygon}
          pathOptions={{ color: ALERT_COLOR[river.severity], weight: 3, fill: false, className: "aegis-alert-pulse" }}
        >
          <Tooltip sticky>{river.isDemo ? "Demo: " : ""}{river.title}</Tooltip>
        </Polygon>
      ))}
      {edges.map((edge) => {
        const alert = roads[edge.id]?.alert;
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        if (!alert || !source || !target) return null;
        const reading = roads[edge.id]?.reading;
        return (
          <Polyline
            key={`alert-${edge.id}`}
            positions={roadPath(edge, source, target)}
            pathOptions={{ color: ALERT_COLOR[alert.severity], weight: 14, opacity: 0.55, className: "aegis-alert-pulse" }}
            eventHandlers={{ click: () => onSelect?.({ kind: "edge", id: edge.id }) }}
          >
            <Tooltip sticky>
              Road {edge.id}: {alert.title}
              {reading && !alert.isDemo && ` · TomTom ${reading.currentSpeed} km/h, usually ${reading.freeFlowSpeed}`}
            </Tooltip>
          </Polyline>
        );
      })}
    </>
  );
}
