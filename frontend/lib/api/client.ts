import type { ComparisonResult, RunResult, ScenarioConfig, SimulationParams } from "@/lib/schemas/types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

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
    throw new Error(body.message ?? `Request to ${path} failed with status ${response.status}`);
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

export interface AlternativePlanResponse {
  feasible: boolean;
  reason?: string;
  baselineRun?: RunResult;
  alternativeRun?: RunResult;
  changes: PlanChange[];
  tradeOffs: string[];
}

export const generateAlternativePlan = (
  request: { scenarioId: string; randomSeed?: number } & ScenarioOverrides
) =>
  apiFetch<AlternativePlanResponse>("/api/optimization/plan", {
    method: "POST", body: JSON.stringify(request),
  });

export const compareRuns = (baselineRun: RunResult, alternativeRun: RunResult) =>
  apiFetch<ComparisonResult>("/api/simulations/compare", {
    method: "POST", body: JSON.stringify({ baselineRun, alternativeRun }),
  });
