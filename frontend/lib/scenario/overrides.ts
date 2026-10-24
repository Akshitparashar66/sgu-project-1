import type { ScenarioConfig } from "@/lib/schemas/types";

/** What-if changes a planner makes in the Scenario Lab (PRD §5.2 Journey B), or applies from a live alert. */
export interface Overrides {
  closedEdgeIds: string[];
  unavailableShelterIds: string[];
  /** Share of a road's capacity left, e.g. {E4: 0.5} for a road jammed to half its usual speed. */
  edgeCapacityFactors: Record<string, number>;
}

export const NO_OVERRIDES: Overrides = { closedEdgeIds: [], unavailableShelterIds: [], edgeCapacityFactors: {} };

export function hasOverrides(overrides: Overrides): boolean {
  return overrides.closedEdgeIds.length > 0 || overrides.unavailableShelterIds.length > 0
    || Object.keys(overrides.edgeCapacityFactors).length > 0;
}

/** Set a road's capacity share; 1 (or null) removes the change. */
export function withCapacity(factors: Record<string, number>, edgeId: string, factor: number | null): Record<string, number> {
  const next = { ...factors };
  if (factor === null || factor >= 1) delete next[edgeId];
  else next[edgeId] = factor;
  return next;
}

export function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/**
 * Client-side mirror of backend app/services/scenario_overrides.py, used only
 * so the map shows a closure the moment it's made. The simulation itself
 * always runs server-side with the same overrides sent in the request.
 */
export function applyOverrides(scenario: ScenarioConfig, overrides: Overrides): ScenarioConfig {
  if (!hasOverrides(overrides)) return scenario;
  const closed = new Set(overrides.closedEdgeIds);
  const unavailable = new Set(overrides.unavailableShelterIds);
  const factors = overrides.edgeCapacityFactors;
  return {
    ...scenario,
    edges: scenario.edges.map((e) => {
      const edge = closed.has(e.id) ? { ...e, status: "closed" as const } : e;
      return e.id in factors
        ? { ...edge, capacityPerTick: Math.max(1, Math.round(e.capacityPerTick * factors[e.id])) }
        : edge;
    }),
    shelters: scenario.shelters.map((s) => (unavailable.has(s.id) ? { ...s, available: false } : s)),
  };
}

