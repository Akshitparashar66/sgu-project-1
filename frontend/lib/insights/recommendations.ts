import { formatCompletionTick } from "@/lib/metrics/format";
import type { RunResult, ScenarioConfig } from "@/lib/schemas/types";

export type Severity = "critical" | "warning" | "info" | "ok";

export interface Recommendation {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
}

/** Roads above this demand/capacity ratio are called out as bottlenecks (matches the map's "badly congested" red). */
export const BOTTLENECK_RATIO = 1.5;
const MAX_BOTTLENECKS = 3;
const SEVERITY_ORDER: Severity[] = ["critical", "warning", "info", "ok"];

/**
 * Rule-based findings derived only from a scenario and a real RunResult —
 * every number quoted is read from those two inputs, never estimated
 * (master plan "rule-based recommendations"; PRD Global Principle #2).
 */
export function buildRecommendations(scenario: ScenarioConfig, run: RunResult): Recommendation[] {
  const recs: Recommendation[] = [];
  const nodeLabel = new Map(scenario.nodes.map((n) => [n.id, n.label ?? n.id]));
  const shelterName = new Map(scenario.shelters.map((s) => [s.id, s.name]));
  const { tickSeconds, maxTicks } = scenario.defaultParams;

  // 1. Capacity: if demand exceeds available places, no routing can help.
  const demand = scenario.zones.reduce((sum, z) => sum + z.evacueeCount, 0);
  const capacity = scenario.shelters
    .filter((s) => s.available)
    .reduce((sum, s) => sum + (s.totalCapacity - s.occupied), 0);
  const shortfall = Math.max(0, demand - capacity);
  const standby = scenario.shelters.filter((s) => s.standby && !s.available);
  const standbyPlaces = standby.reduce((sum, s) => sum + s.totalCapacity, 0);
  const standbyNote = standbyPlaces > 0
    ? ` Standby sites (${standby.map((s) => s.name).join(", ")}) hold ${standbyPlaces} more; Optimize plan opens them if that helps.`
    : "";
  if (shortfall > 0) {
    recs.push({
      id: "capacity-shortfall", severity: "critical",
      title: `Shelter capacity shortfall: ${shortfall} evacuees have no place`,
      detail: `Demand is ${demand} evacuees but only ${capacity} available shelter places exist. No routing change can fix this — open or reopen at least ${shortfall} places.${standbyNote}`,
    });
  }

  // 2. Reachability: unassigned beyond the capacity shortfall means zones cut off by closures.
  const unassigned = run.agents.filter((a) => !a.assignedShelter);
  const cutOff = unassigned.length - shortfall;
  if (cutOff > 0) {
    const zones = [...new Set(unassigned.map((a) => a.originZone))].join(", ");
    recs.push({
      id: "unreachable", severity: "critical",
      title: `${cutOff} evacuees cannot reach any shelter with space`,
      detail: `Affected zones: ${zones}. Check the road closures isolating them, or open a shelter they can reach.`,
    });
  }

  // 3. Time limit: agents still en route when the simulation clock ran out.
  const stranded = run.warnings.filter((w) => w.includes("did not resolve within")).length;
  if (run.metrics.hitTickLimit && stranded > 0) {
    recs.push({
      id: "tick-limit", severity: "critical",
      title: `${stranded} evacuees still en route when the clock ran out`,
      detail: `The simulation stops at ${maxTicks} ticks (${Math.round((maxTicks * tickSeconds) / 60)} min). Relieve the worst bottleneck or stagger departures so they finish in time.`,
    });
  }

  // 4. Shelters that turned arrivals away at the door.
  for (const shelter of run.shelters.filter((s) => s.rejectedCount > 0)) {
    recs.push({
      id: `rejected-${shelter.shelterId}`, severity: "warning",
      title: `${shelterName.get(shelter.shelterId) ?? shelter.shelterId} turned away ${shelter.rejectedCount} arrivals`,
      detail: `It filled to ${shelter.finalOccupied}/${shelter.totalCapacity} before everyone assigned to it arrived. Redirect part of its assignment earlier.`,
    });
  }

  // 5. Bottleneck roads.
  const edgeById = new Map(scenario.edges.map((e) => [e.id, e]));
  const bottlenecks = run.congestion
    .filter((c) => c.peakDemandToCapacity > BOTTLENECK_RATIO)
    .sort((a, b) => b.peakDemandToCapacity - a.peakDemandToCapacity)
    .slice(0, MAX_BOTTLENECKS);
  for (const c of bottlenecks) {
    const edge = edgeById.get(c.edgeId);
    const routed = run.agents.filter((a) => a.routeEdgeIds.includes(c.edgeId)).length;
    const where = edge ? `${nodeLabel.get(edge.source)} → ${nodeLabel.get(edge.target)}` : c.edgeId;
    recs.push({
      id: `bottleneck-${c.edgeId}`, severity: "warning",
      title: `Road ${c.edgeId} peaks at ${c.peakDemandToCapacity.toFixed(1)}× capacity`,
      detail: `${where}: ${routed} evacuees routed over it, ${(c.totalDelayS / 3600).toFixed(1)} agent-hours of congestion delay (peak at tick ${c.peakTick}). Consider staggered departures, contraflow or traffic marshals here.`,
    });
  }

  // 6. Hazard exposure along chosen routes.
  const hazardEdges = scenario.edges.filter((e) => e.hazardRisk > 0);
  const exposed = run.agents.filter((a) => a.routeEdgeIds.some((id) => hazardEdges.some((e) => e.id === id)));
  if (exposed.length > 0) {
    const used = hazardEdges
      .filter((e) => exposed.some((a) => a.routeEdgeIds.includes(e.id)))
      .map((e) => `${e.id} (${Math.round(e.hazardRisk * 100)}% risk)`)
      .join(", ");
    recs.push({
      id: "hazard-exposure", severity: "info",
      title: `${exposed.length} evacuees cross hazard-exposed roads`,
      detail: `Roads: ${used}. Routing already penalizes hazard risk, so these were still the best options — pre-position responders along them.`,
    });
  }

  if (run.metrics.unservedCount === 0 && !run.metrics.hitTickLimit) {
    recs.push({
      id: "all-clear", severity: "ok",
      title: `All ${run.metrics.evacuatedCount} evacuees reached shelter in ${formatCompletionTick(run.metrics.completionTick, false, tickSeconds)}`,
      detail: "Under this scenario's assumptions every evacuee was assigned a reachable shelter with space and arrived before the time limit.",
    });
  }

  return recs.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
}
