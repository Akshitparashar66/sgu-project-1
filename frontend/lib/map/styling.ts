import type { AgentStatus, RoadStatus } from "@/lib/schemas/types";

// Palette: cyan = normal/open, amber = warning/congested/near-capacity,
// red = danger/closed/full, green = safe/available, slate = idle/unknown.
// Keep these as the single source of truth — Legend.tsx renders this
// exact palette, so a change here must be reflected there.
export function roadColor(status: RoadStatus, congestionRatio: number): string {
  if (status === "closed") return "#ef4444";
  if (status === "restricted") return "#f59e0b";
  if (congestionRatio > 1.5) return "#ef4444";
  if (congestionRatio > 1.0) return "#f59e0b";
  return "#22d3ee";
}

export function roadDashArray(status: RoadStatus): string | undefined {
  return status === "closed" ? "6 4" : undefined;
}

export function shelterFillColor(occupied: number, totalCapacity: number): string {
  if (totalCapacity <= 0) return "#64748b";
  const ratio = occupied / totalCapacity;
  if (ratio >= 1.0) return "#ef4444";
  if (ratio >= 0.8) return "#f59e0b";
  return "#22c55e";
}

export function agentMarkerColor(status: AgentStatus): string {
  switch (status) {
    case "arrived": return "#22c55e";
    case "unserved": return "#ef4444";
    case "delayed": return "#f59e0b";
    case "moving": return "#22d3ee";
    case "waiting":
    default: return "#94a3b8";
  }
}
