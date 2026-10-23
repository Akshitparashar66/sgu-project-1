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
  summary: { nodes: number; edges: number; zones: number; shelters: number; evacuees: number; shelterCapacity: number };
}

/** PRD §10.4 — check a candidate scenario file without saving or running it. Throws ApiError with `errors`. */
export const validateScenario = (scenario: unknown) =>
  apiFetch<ValidationSummary>("/api/scenarios/validate", { method: "POST", body: JSON.stringify(scenario) });

export const compareRuns = (baselineRun: RunResult, alternativeRun: RunResult) =>
  apiFetch<ComparisonResult>("/api/simulations/compare", {
    method: "POST", body: JSON.stringify({ baselineRun, alternativeRun }),
  });

export interface TargetError {
  mae: number;
  p90AbsError: number;
  labMae: number;
  labP90AbsError: number;
  r2: number | null;
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
      model: SurrogateCard;
    };

/** Instant machine-learning estimate of a run's headline numbers; running the simulation gives the real ones. */
export const predictOutcome = (request: { scenarioId: string } & ScenarioOverrides, signal?: AbortSignal) =>
  apiFetch<OutcomeEstimate>("/api/predict", { method: "POST", body: JSON.stringify(request), signal });
