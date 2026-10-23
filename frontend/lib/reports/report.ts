import type { RunResult, ScenarioConfig } from "@/lib/schemas/types";

export interface ZoneOutcome {
  zoneId: string;
  name: string;
  evacuees: number;
  arrived: number;
  unserved: number;
  /** Mean time to reach shelter for those who did; null if nobody arrived. */
  meanArrivalMinutes: number | null;
}

export function zoneOutcomes(scenario: ScenarioConfig, run: RunResult): ZoneOutcome[] {
  const { tickSeconds } = scenario.defaultParams;
  return scenario.zones.map((zone) => {
    const agents = run.agents.filter((a) => a.originZone === zone.id);
    const arrivals = agents.filter((a) => a.status === "arrived" && a.arrivalTick != null);
    const meanTicks = arrivals.length
      ? arrivals.reduce((sum, a) => sum + (a.arrivalTick ?? 0), 0) / arrivals.length
      : null;
    return {
      zoneId: zone.id,
      name: zone.name,
      evacuees: zone.evacueeCount,
      arrived: arrivals.length,
      unserved: agents.filter((a) => a.status === "unserved").length,
      meanArrivalMinutes: meanTicks === null ? null : (meanTicks * tickSeconds) / 60,
    };
  });
}

export interface RoadRow {
  edgeId: string;
  from: string;
  to: string;
  routed: number;
  peakRatio: number;
  peakTick: number;
  delayHours: number;
}

/** Every road a run touched, worst peak congestion first. */
export function roadReport(scenario: ScenarioConfig, run: RunResult): RoadRow[] {
  const label = new Map(scenario.nodes.map((n) => [n.id, n.label ?? n.id]));
  const edges = new Map(scenario.edges.map((e) => [e.id, e]));
  return run.congestion
    .map((c) => {
      const edge = edges.get(c.edgeId);
      return {
        edgeId: c.edgeId,
        from: edge ? label.get(edge.source) ?? edge.source : "?",
        to: edge ? label.get(edge.target) ?? edge.target : "?",
        routed: run.agents.filter((a) => a.routeEdgeIds.includes(c.edgeId)).length,
        peakRatio: c.peakDemandToCapacity,
        peakTick: c.peakTick,
        delayHours: c.totalDelayS / 3600,
      };
    })
    .sort((a, b) => b.peakRatio - a.peakRatio);
}
