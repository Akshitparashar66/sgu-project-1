import type { ComparisonResult, RunResult, ScenarioConfig, SimulationParams } from "@/lib/schemas/types";

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export interface FieldError {
  field: string | null;
  message: string;
}

/** The backend's structured error ({errorCode, message, field, errors?}), kept intact for the UI. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorCode: string | null = null,
    readonly field: string | null = null,
    readonly errors: FieldError[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    // fetch only rejects on network failure (server down, CORS, offline).
    throw new Error(
      `Cannot reach the AEGIS backend at ${API_BASE}. Is it running? (cd backend && uvicorn app.main:app --port 8000)`
    );
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(
      body.message ?? `Request to ${path} failed with status ${response.status}`,
      response.status, body.errorCode ?? null, body.field ?? null, body.errors ?? [],
    );
  }
  return response.json() as Promise<T>;
}

export interface ScenarioSummary {
  id: string;
  name: string;
  description: string;
  synthetic: boolean;
}

/** What-if changes made in the Scenario Lab, applied server-side to a copy of the scenario. */
export interface ScenarioOverrides {
  closedEdgeIds?: string[];
  unavailableShelterIds?: string[];
}

export const fetchHealth = () => apiFetch<{ status: string; version: string }>("/api/health");

export const fetchScenarios = () => apiFetch<ScenarioSummary[]>("/api/scenarios");

export const fetchScenario = (scenarioId: string) =>
  apiFetch<ScenarioConfig>(`/api/scenarios/${scenarioId}`);

export const runSimulation = (
  request: { scenarioId: string; planLabel?: string; params?: SimulationParams } & ScenarioOverrides
) => apiFetch<RunResult>("/api/simulations/run", { method: "POST", body: JSON.stringify(request) });

export interface PlanChange {
  agentId: string;
  originZone: string;
  oldShelter: string | null;
  newShelter: string | null;
  reason: string;
}

/** One line of the optimized plan: a group of evacuees, where they go, by which roads, and when they leave. */
export interface EvacuationOrder {
  zoneId: string;
  movementProfile: string;
  people: number;
  shelterId: string;
  routeEdgeIds: string[];
  departureMinute: number;
}

export interface PlanSearchInfo {
  method: string;
  iterations: number;
  plansEvaluated: number;
  blockSize: number;
  runtimeMs: number;
  /** No plan can clear sooner than this, given walking times and road capacities. */
  clearanceLowerBoundMinutes: number | null;
}

export interface Percentiles {
  p10: number;
  p50: number;
  p90: number;
}

export interface RangeSummary {
  clearanceMinutes: Percentiles;
  unserved: Percentiles;
  averageMinutes: Percentiles;
  /** Variations in which the plan ran out of time. */
  hitTimeLimit: number;
}

/** Both plans re-run under the same random variations (speed, road capacity, reaction time, compliance). */
export interface PlanRobustness {
  variations: number;
  assumptions: string[];
  baseline: RangeSummary;
  optimized: RangeSummary;
  /** Variations in which the optimized plan scored better than the baseline. */
  optimizedBetter: number;
}

export interface AlternativePlanResponse {
  feasible: boolean;
  reason?: string;
  baselineRun?: RunResult;
  alternativeRun?: RunResult;
  changes: PlanChange[];
  tradeOffs: string[];
  orders?: EvacuationOrder[];
  search?: PlanSearchInfo;
  robustness?: PlanRobustness;
  interventions?: PlanInterventions;
}

/** What the optimized plan changes besides who goes where: standby shelters opened, marshals posted. */
export interface PlanInterventions {
  openedShelters: { shelterId: string; name: string }[];
  marshalledRoads: string[];
}

export const generateAlternativePlan = (
  request: { scenarioId: string; randomSeed?: number } & ScenarioOverrides
) =>
  apiFetch<AlternativePlanResponse>("/api/optimization/plan", {
    method: "POST", body: JSON.stringify(request),
  });

export interface ValidationSummary {
  valid: true;
  scenarioId: string;
  summary: {
    nodes: number; edges: number; zones: number; shelters: number; evacuees: number; shelterCapacity: number;
    standbyShelters?: number; standbyCapacity?: number;
  };
}

/** PRD §10.4 — check a candidate scenario file without saving or running it. Throws ApiError with `errors`. */
export const validateScenario = (scenario: unknown) =>
  apiFetch<ValidationSummary>("/api/scenarios/validate", { method: "POST", body: JSON.stringify(scenario) });

export const compareRuns = (baselineRun: RunResult, alternativeRun: RunResult, tickSeconds?: number) =>
  apiFetch<ComparisonResult>("/api/simulations/compare", {
    method: "POST", body: JSON.stringify({ baselineRun, alternativeRun, tickSeconds }),
  });

export interface TargetError {
  mae: number;
  p90AbsError: number;
  labMae: number;
  labP90AbsError: number;
  r2: number | null;
  /** Share of held-out cases whose true value fell inside the estimate's own range. */
  rangeCoverage?: number;
}

export interface SurrogateCard {
  method: string;
  trainedOn: string;
  samples: number;
  testSamples: number;
  labTestSamples: number;
  trainedDate: string;
  testMetrics: Record<"clearanceMinutes" | "unservedShare" | "peakCongestion", TargetError>;
}

export type OutcomeEstimate =
  | { available: false; reason: string }
  | {
      available: true;
      clearanceMinutes: number;
      clearanceAtTimeLimit: boolean;
      unservedCount: number;
      peakCongestion: number;
      evacuees: number;
      runtimeMs: number;
      /** Trained on an older version of the simulation code; retrain before trusting it. */
      outOfDate: boolean;
      /** This estimate's own 10th-90th percentile range (absent for a model trained without ranges). */
      ranges?: {
        clearanceMinutes: [number, number] | null;
        unservedCount: [number, number] | null;
        peakCongestion: [number, number] | null;
      };
      model: SurrogateCard;
    };

/** Instant machine-learning estimate of a run's headline numbers; running the simulation gives the real ones. */
export const predictOutcome = (request: { scenarioId: string; randomSeed?: number } & ScenarioOverrides, signal?: AbortSignal) =>
  apiFetch<OutcomeEstimate>("/api/predict", { method: "POST", body: JSON.stringify(request), signal });

export interface ImportResult {
  scenarioId: string;
  summary: ValidationSummary["summary"];
  warnings: string[];
}

/** Build and save a scenario from the planner's own zones and/or shelters (CSV text) on an existing street network. */
export const importScenario = (request: { baseScenarioId: string; name: string; zonesCsv?: string; sheltersCsv?: string }) =>
  apiFetch<ImportResult>("/api/scenarios/import", { method: "POST", body: JSON.stringify(request) });

export interface WeakPoint {
  kind: "road" | "shelter";
  id: string;
  label: string;
  unservedChange: number;
  clearanceChangeMinutes: number;
  hitTimeLimit: boolean;
}

export interface WeakPointReport {
  baseline: { unserved: number; clearanceMinutes: number; hitTimeLimit: boolean };
  /** Worst loss first. */
  items: WeakPoint[];
}

/** Losing each open road and each available shelter in turn, re-simulated and ranked. */
export const findWeakPoints = (request: { scenarioId: string; randomSeed?: number } & ScenarioOverrides) =>
  apiFetch<WeakPointReport>("/api/analysis/weak-points", { method: "POST", body: JSON.stringify(request) });

export interface SavedPlanSummary {
  id: string;
  name: string;
  version: number;
  savedAt: string;
  preparedBy: string;
  note: string;
  scenarioId: string;
  scenarioName: string;
  feasible: boolean;
  summary: Partial<Record<"baseline" | "optimized", { unserved: number; clearanceMinutes: number | null }>>;
  approvals: { by: string; at: string; note: string }[];
  contentHash: string;
  /** False when the stored file no longer matches its fingerprint. */
  intact: boolean;
}

export interface AuditEvent {
  at: string;
  event: "saved" | "approved";
  planId: string;
  name: string;
  version: number;
  by: string;
  note: string;
  contentHash: string;
}

export const savePlan = (request: { name: string; preparedBy: string; note?: string; scenarioId: string; randomSeed?: number } & ScenarioOverrides) =>
  apiFetch<SavedPlanSummary>("/api/plans", { method: "POST", body: JSON.stringify(request) });

export const listSavedPlans = () => apiFetch<SavedPlanSummary[]>("/api/plans");

export const approvePlan = (planId: string, request: { approvedBy: string; note?: string }) =>
  apiFetch<SavedPlanSummary>(`/api/plans/${encodeURIComponent(planId)}/approve`, { method: "POST", body: JSON.stringify(request) });

export const fetchAuditLog = () => apiFetch<AuditEvent[]>("/api/plans/audit");

export interface RiverReading {
  levelM: number;
  observedAt: string;
  source: "manual" | "feed";
}

export interface RiverGauge {
  id: string;
  name: string;
  river: string;
  readingSource: string;
  /** Set by the district; null until then. */
  warningLevelM: number | null;
  dangerLevelM: number | null;
  latest: RiverReading | null;
  recent: RiverReading[];
  status: "normal" | "warning" | "danger" | "no reading" | "thresholds not set";
  suggestion: { scenarioId: string; message: string } | null;
}

export interface RiverStatus {
  gauges: RiverGauge[];
  feedConnected: boolean;
  feedError: string | null;
}

export const fetchRiverStatus = () => apiFetch<RiverStatus>("/api/river");

export const addRiverReading = (gaugeId: string, levelM: number) =>
  apiFetch<RiverStatus>(`/api/river/${encodeURIComponent(gaugeId)}/reading`, { method: "POST", body: JSON.stringify({ levelM }) });

export const setRiverThresholds = (gaugeId: string, warningLevelM: number, dangerLevelM: number) =>
  apiFetch<RiverStatus>(`/api/river/${encodeURIComponent(gaugeId)}/thresholds`, {
    method: "POST", body: JSON.stringify({ warningLevelM, dangerLevelM }),
  });

