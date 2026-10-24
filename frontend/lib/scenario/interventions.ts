import type { PlanInterventions } from "@/lib/api/client";
import type { ScenarioConfig } from "@/lib/schemas/types";

// Mirrors MARSHAL_CAPACITY_FACTOR in backend/app/optimization/search.py.
export const MARSHAL_CAPACITY_FACTOR = 1.25;

/** The scenario as the optimized plan changes it, so its replay shows opened standby shelters and marshalled roads. */
export function applyInterventions(scenario: ScenarioConfig, interventions: PlanInterventions | undefined): ScenarioConfig {
  if (!interventions || (interventions.openedShelters.length === 0 && interventions.marshalledRoads.length === 0)) return scenario;
  const opened = new Set(interventions.openedShelters.map((s) => s.shelterId));
  const marshalled = new Set(interventions.marshalledRoads);
  return {
    ...scenario,
    shelters: scenario.shelters.map((s) => (opened.has(s.id) ? { ...s, available: true } : s)),
    edges: scenario.edges.map((e) =>
      marshalled.has(e.id)
        ? { ...e, capacityPerTick: Math.max(e.capacityPerTick + 1, Math.round(e.capacityPerTick * MARSHAL_CAPACITY_FACTOR)) }
        : e),
  };
}
