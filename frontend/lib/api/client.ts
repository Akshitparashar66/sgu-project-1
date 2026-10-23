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

/** Whether the backend has a Gemini API key. Without them both AI features use their offline fallback. */
export const fetchAiStatus = () => apiFetch<{ configured: boolean; provider: string; model: string; fallbackModels: string[] }>("/api/ai/status");

export interface Briefing {
  /** "gemini": written by Gemini and every number checked against the run; "template": fixed-sentence summary. */
  source: "gemini" | "template";
  text: string;
  facts: Record<string, unknown>;
  warnings: string[];
}

/** Briefs the run for these exact inputs (the backend re-runs it deterministically with the same seed). */
export const requestBriefing = (
  request: { scenarioId: string; randomSeed: number; includePlan?: boolean } & ScenarioOverrides
) => apiFetch<Briefing>("/api/ai/briefing", { method: "POST", body: JSON.stringify(request) });

export interface WhatIfProposal {
  /** "gemini": interpreted by Gemini; "keywords": offline id/name matching. */
  source: "gemini" | "keywords";
  closeEdgeIds: string[];
  reopenEdgeIds: string[];
  unavailableShelterIds: string[];
  restoreShelterIds: string[];
  interpretation: string;
  /** Parts of the question that can't be expressed as road/shelter changes. */
  unmatched: string[];
  warnings: string[];
}

export const interpretWhatIf = (request: { scenarioId: string; question: string } & ScenarioOverrides) =>
  apiFetch<WhatIfProposal>("/api/ai/what-if", { method: "POST", body: JSON.stringify(request) });
