import type { ScenarioConfig } from "@/lib/schemas/types";

/** What-if changes a planner makes in the Scenario Lab (PRD §5.2 Journey B). */
export interface Overrides {
  closedEdgeIds: string[];
  unavailableShelterIds: string[];
}

export const NO_OVERRIDES: Overrides = { closedEdgeIds: [], unavailableShelterIds: [] };

export function hasOverrides(overrides: Overrides): boolean {
  return overrides.closedEdgeIds.length > 0 || overrides.unavailableShelterIds.length > 0;
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
  return {
    ...scenario,
    edges: scenario.edges.map((e) => (closed.has(e.id) ? { ...e, status: "closed" } : e)),
    shelters: scenario.shelters.map((s) => (unavailable.has(s.id) ? { ...s, available: false } : s)),
  };
}

/** A set of what-if changes to make on top of the current overrides (e.g. parsed from a typed question). */
export interface OverrideChanges {
  closeEdgeIds: string[];
  reopenEdgeIds: string[];
  unavailableShelterIds: string[];
  restoreShelterIds: string[];
}

export function mergeOverrides(overrides: Overrides, changes: OverrideChanges): Overrides {
  const merge = (current: string[], add: string[], remove: string[]) =>
    [...new Set([...current, ...add])].filter((id) => !remove.includes(id));
  return {
    closedEdgeIds: merge(overrides.closedEdgeIds, changes.closeEdgeIds, changes.reopenEdgeIds),
    unavailableShelterIds: merge(overrides.unavailableShelterIds, changes.unavailableShelterIds, changes.restoreShelterIds),
  };
}
