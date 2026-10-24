import type { SimulationStatus } from "@/components/layout/AppShell";
import type { MapSelection } from "@/components/map/layers/types";
import type { AlternativePlanResponse, ScenarioSummary } from "@/lib/api/client";
import { NO_OVERRIDES, type Overrides, toggleId, withCapacity } from "@/lib/scenario/overrides";
import type { ComparisonResult, RunResult, ScenarioConfig } from "@/lib/schemas/types";

export interface AegisState {
  scenarios: ScenarioSummary[];
  scenario: ScenarioConfig | null;
  overrides: Overrides;
  /** Live alerts whose conditions are in the current what-ifs, for the trail ("applied from alert …"). */
  appliedAlerts: AppliedAlert[];
  seed: number;
  status: SimulationStatus;
  busy: "run" | "plan" | null;
  error: string | null;
  run: RunResult | null;
  /** runKey() of the inputs `run` was simulated with. */
  runInputs: string | null;
  plan: AlternativePlanResponse | null;
  comparison: ComparisonResult | null;
  planInputs: string | null;
  selection: MapSelection;
}

export interface AppliedAlert {
  id: string;
  title: string;
  isDemo: boolean;
  appliedAt: string;
}

/** What applying an alert changes; ids the loaded scenario doesn't have are skipped. */
export interface AlertConditions {
  closedEdgeIds?: string[];
  edgeCapacityFactors?: Record<string, number>;
}

export type AegisAction =
  | { type: "scenariosLoaded"; scenarios: ScenarioSummary[] }
  | { type: "scenarioLoaded"; scenario: ScenarioConfig }
  | { type: "runStarted" }
  | { type: "runSucceeded"; run: RunResult; key: string }
  | { type: "planStarted" }
  | { type: "planSucceeded"; plan: AlternativePlanResponse; comparison: ComparisonResult | null; key: string }
  | { type: "failed"; message: string }
  | { type: "toggleEdge"; edgeId: string }
  | { type: "toggleShelter"; shelterId: string }
  | { type: "setEdgeCapacity"; edgeId: string; factor: number | null }
  | { type: "applyAlert"; alert: AppliedAlert; conditions: AlertConditions }
  | { type: "clearOverrides" }
  | { type: "setSeed"; seed: number }
  | { type: "select"; selection: MapSelection }
  | { type: "reset" };

export const initialAegisState: AegisState = {
  scenarios: [],
  scenario: null,
  overrides: NO_OVERRIDES,
  appliedAlerts: [],
  seed: 42,
  status: "idle",
  busy: null,
  error: null,
  run: null,
  runInputs: null,
  plan: null,
  comparison: null,
  planInputs: null,
  selection: null,
};

/** Everything a simulation result depends on. Two runs with equal keys are the same experiment. */
export function runKey(state: Pick<AegisState, "scenario" | "overrides" | "seed">): string {
  return JSON.stringify({
    scenarioId: state.scenario?.id ?? null,
    closed: [...state.overrides.closedEdgeIds].sort(),
    unavailable: [...state.overrides.unavailableShelterIds].sort(),
    capacity: Object.entries(state.overrides.edgeCapacityFactors).sort(),
    seed: state.seed,
  });
}

/** True when what's on screen no longer matches the inputs the run was made with. */
export function isRunStale(state: AegisState): boolean {
  return state.run !== null && state.runInputs !== runKey(state);
}

export function isPlanStale(state: AegisState): boolean {
  return state.plan !== null && state.planInputs !== runKey(state);
}

const clearedResults = {
  run: null, runInputs: null, plan: null, comparison: null, planInputs: null,
  selection: null, status: "idle" as const, busy: null, error: null,
};

export function aegisReducer(state: AegisState, action: AegisAction): AegisState {
  switch (action.type) {
    case "scenariosLoaded":
      return { ...state, scenarios: action.scenarios };
    case "scenarioLoaded":
      return {
        ...state, ...clearedResults,
        scenario: action.scenario, overrides: NO_OVERRIDES, appliedAlerts: [], seed: action.scenario.defaultParams.randomSeed,
      };
    case "runStarted":
      return { ...state, status: "running", busy: "run", error: null };
    case "runSucceeded":
      return { ...state, status: "completed", busy: null, run: action.run, runInputs: action.key };
    case "planStarted":
      return { ...state, status: "running", busy: "plan", error: null };
    case "planSucceeded":
      return {
        ...state, status: "completed", busy: null,
        plan: action.plan, comparison: action.comparison, planInputs: action.key,
        // The optimizer's baseline is the exact run /simulations/run returns for
        // the same scenario, overrides and seed — so Overview, Live Simulation
        // and Reports can use it instead of saying "no run yet".
        ...(action.plan.baselineRun ? { run: action.plan.baselineRun, runInputs: action.key } : {}),
      };
    case "failed":
      return { ...state, status: "error", busy: null, error: action.message };
    case "toggleEdge":
      return { ...state, overrides: { ...state.overrides, closedEdgeIds: toggleId(state.overrides.closedEdgeIds, action.edgeId) } };
    case "toggleShelter":
      return {
        ...state,
        overrides: { ...state.overrides, unavailableShelterIds: toggleId(state.overrides.unavailableShelterIds, action.shelterId) },
      };
    case "setEdgeCapacity":
      return {
        ...state,
        overrides: { ...state.overrides, edgeCapacityFactors: withCapacity(state.overrides.edgeCapacityFactors, action.edgeId, action.factor) },
      };
    case "applyAlert": {
      const known = new Set(state.scenario?.edges.map((e) => e.id) ?? []);
      const closed = (action.conditions.closedEdgeIds ?? []).filter((id) => known.has(id));
      const factors = Object.entries(action.conditions.edgeCapacityFactors ?? {}).filter(([id]) => known.has(id));
      return {
        ...state,
        overrides: {
          ...state.overrides,
          closedEdgeIds: [...new Set([...state.overrides.closedEdgeIds, ...closed])],
          edgeCapacityFactors: { ...state.overrides.edgeCapacityFactors, ...Object.fromEntries(factors) },
        },
        appliedAlerts: [...state.appliedAlerts.filter((a) => a.id !== action.alert.id), action.alert],
      };
    }
    case "clearOverrides":
      return { ...state, overrides: NO_OVERRIDES, appliedAlerts: [] };
    case "setSeed":
      return { ...state, seed: action.seed };
    case "select":
      return { ...state, selection: action.selection };
    case "reset":
      // The loaded scenario is never mutated (overrides are applied to copies),
      // so dropping results and overrides restores the exact pre-run state.
      return { ...state, ...clearedResults, overrides: NO_OVERRIDES, appliedAlerts: [] };
  }
}
