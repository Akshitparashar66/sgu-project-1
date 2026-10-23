// Mirrors backend/app/models/schemas.py. Keep in sync by hand.
export type RoadStatus = "open" | "closed" | "restricted";
export type AgentStatus = "waiting" | "moving" | "delayed" | "arrived" | "unserved";

export interface RoadNode {
  id: string;
  lat: number;
  lon: number;
  label?: string;
}

export interface RoadEdge {
  id: string;
  source: string;
  target: string;
  lengthM: number;
  capacityPerTick: number;
  baseTravelTimeS: number;
  status: RoadStatus;
  hazardRisk: number;
  /** Street path from source to target, [lat, lon] pairs. Drawing only; absent = straight line. */
  geometry?: [number, number][] | null;
}

export interface PopulationZone {
  id: string;
  name: string;
  connectorNode: string;
  evacueeCount: number;
  movementProfile: Record<string, number>;
}

export interface Shelter {
  id: string;
  name: string;
  connectorNode: string;
  totalCapacity: number;
  occupied: number;
  available: boolean;
}

export interface HazardZone {
  id: string;
  polygon: [number, number][];
  severity: number;
  startTick: number;
  endTick?: number;
}

export interface SimulationParams {
  tickSeconds: number;
  maxTicks: number;
  randomSeed: number;
}

export interface ScenarioConfig {
  id: string;
  name: string;
  description: string;
  synthetic: boolean;
  nodes: RoadNode[];
  edges: RoadEdge[];
  zones: PopulationZone[];
  shelters: Shelter[];
  hazards: HazardZone[];
  defaultParams: SimulationParams;
}

// Output of Member 2's assignment step — not normally fetched directly by
// the frontend, but mirrored here because Member 3/4 may want to render an
// in-progress "planning" state before a run completes.
export interface AgentPlan {
  agentId: string;
  originZone: string;
  assignedShelter?: string;
  routeEdgeIds: string[];
  movementProfile: string;
  distanceM: number;
}

export interface AgentResult {
  id: string;
  originZone: string;
  assignedShelter?: string;
  routeEdgeIds: string[];
  status: AgentStatus;
  arrivalTick?: number;
  movementProfile: string;
  // Replay timing, aligned with routeEdgeIds: edge i is occupied from
  // edgeEntryTicks[i] through edgeExitTicks[i] inclusive. An entry with no
  // matching exit means the agent was still on that edge at max_ticks.
  edgeEntryTicks: number[];
  edgeExitTicks: number[];
}

export interface EdgeCongestionResult {
  edgeId: string;
  peakDemandToCapacity: number;
  peakTick: number;
  totalDelayS: number;
}

export interface ShelterResult {
  shelterId: string;
  totalCapacity: number;
  finalOccupied: number;
  rejectedCount: number;
}

export interface RunMetrics {
  evacuatedCount: number;
  unservedCount: number;
  completionTick: number | null;
  hitTickLimit: boolean;
  maxCongestionRatio: number;
  runtimeMs: number;
}

export interface RunResult {
  runId: string;
  scenarioId: string;
  planLabel: "baseline" | "alternative";
  randomSeed: number;
  metrics: RunMetrics;
  agents: AgentResult[];
  shelters: ShelterResult[];
  congestion: EdgeCongestionResult[];
  warnings: string[];
}

export interface MetricComparison {
  metricName: string;
  baselineValue: number;
  alternativeValue: number;
  absoluteDiff: number;
  percentDiff: number | null;
  improved: boolean | null;
}

export interface ComparisonResult {
  baselineRunId: string;
  alternativeRunId: string;
  metrics: MetricComparison[];
  warnings: string[];
}
