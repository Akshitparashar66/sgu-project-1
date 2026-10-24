import type { AlertSeverity, AlertsOverview, LiveAlert, TrafficReading } from "@/lib/api/client";
import type { ScenarioConfig } from "@/lib/schemas/types";

export const SEVERITY_RANK: Record<AlertSeverity, number> = { info: 0, warning: 1, severe: 2, extreme: 3 };

const needsAttention = (a: LiveAlert) => a.status === "active" && SEVERITY_RANK[a.severity] >= SEVERITY_RANK.warning;

/** The banner shows the most serious unacknowledged alert at warning or above, newest first among equals. */
export function bannerAlert(alerts: LiveAlert[]): LiveAlert | null {
  return alerts
    .filter(needsAttention)
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.raisedAt.localeCompare(a.raisedAt))[0] ?? null;
}

/** Alerts still needing attention (active, warning or worse): the nav badge. */
export function openAlertCount(alerts: LiveAlert[]): number {
  return alerts.filter(needsAttention).length;
}

export interface RoadCondition {
  reading?: TrafficReading;
  alert?: LiveAlert;
}

/** Live traffic per road id: the latest TomTom reading and any open traffic alert (real or demo). */
export function roadConditions(overview: AlertsOverview | null): Record<string, RoadCondition> {
  const byEdge: Record<string, RoadCondition> = {};
  for (const reading of overview?.sources.traffic.readings ?? []) {
    if (reading.usable) for (const id of reading.edgeIds) byEdge[id] = { reading };
  }
  for (const alert of overview?.alerts ?? []) {
    if (alert.status === "expired" || !alert.edgeIds?.length) continue;
    for (const id of alert.edgeIds) byEdge[id] = { ...byEdge[id], alert };
  }
  return byEdge;
}

/** Official and river alerts have no road: shown as a badge on the map rather than a shape. */
export function areaAlerts(overview: AlertsOverview | null): LiveAlert[] {
  return (overview?.alerts ?? []).filter((a) => a.status !== "expired" && !a.edgeIds?.length);
}

/**
 * Whether "Apply" can do anything for the loaded scenario: open the alert's
 * scenario, or change roads that the scenario has. Traffic alerts name roads
 * of the 7-road network, so they don't apply to the detailed network (G).
 */
export function applicability(alert: LiveAlert, scenario: ScenarioConfig | null): { ok: boolean; reason?: string } {
  const action = alert.action;
  if (!action) return { ok: false, reason: "This alert has nothing to apply" };
  if (action.scenarioId) return { ok: true };
  const ids = [...(action.closedEdgeIds ?? []), ...Object.keys(action.edgeCapacityFactors ?? {})];
  const known = new Set(scenario?.edges.map((e) => e.id) ?? []);
  return ids.some((id) => known.has(id))
    ? { ok: true }
    : { ok: false, reason: `The loaded scenario has no road ${ids.join(" or ")}` };
}

export function timeAgo(iso: string, now: Date = new Date()): string {
  const minutes = Math.round((now.getTime() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : new Date(iso).toLocaleDateString();
}

export const SOURCE_LABEL: Record<LiveAlert["source"], string> = {
  ndma: "NDMA official alert", river: "River gauge", glofas: "GloFAS flow forecast", traffic: "TomTom traffic", demo: "Demo",
};
