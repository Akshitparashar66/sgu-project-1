import type { AgentStatus, RoadStatus } from "@/lib/schemas/types";

// Palette: blue = normal/open, amber = warning/congested/near-capacity,
// red = danger/closed/full, green = safe/available, slate = idle/unknown.
// Keep these as the single source of truth — Legend.tsx renders this
// exact palette, so a change here must be reflected there.
export const HAZARD_COLOR = "#dc2626";
// Violet sits outside the status palette on purpose: a population zone is a
// place, not a state, so it must never read as "safe" or "danger".
export const ZONE_COLOR = "#7c3aed";
export const UNAVAILABLE_COLOR = "#64748b";
export const ROAD_CASING_COLOR = "#ffffff";

export function roadColor(status: RoadStatus, congestionRatio: number): string {
  if (status === "closed") return "#dc2626";
  if (status === "restricted") return "#d97706";
  if (congestionRatio > 1.5) return "#dc2626";
  if (congestionRatio > 1.0) return "#d97706";
  return "#2563eb";
}

export function roadDashArray(status: RoadStatus): string | undefined {
  return status === "closed" ? "6 4" : undefined;
}

export function shelterFillColor(occupied: number, totalCapacity: number): string {
  if (totalCapacity <= 0) return "#64748b";
  const ratio = occupied / totalCapacity;
  if (ratio >= 1.0) return "#dc2626";
  if (ratio >= 0.8) return "#d97706";
  return "#16a34a";
}

export function agentMarkerColor(status: AgentStatus): string {
  switch (status) {
    case "arrived": return "#16a34a";
    case "unserved": return "#dc2626";
    case "delayed": return "#d97706";
    case "moving": return "#2563eb";
    case "waiting":
    default: return "#94a3b8";
  }
}
