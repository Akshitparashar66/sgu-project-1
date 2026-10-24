import { type LatLon, pointAlong, roadPath } from "@/lib/map/roadPath";
import type { AgentResult, AgentStatus, RunResult, ScenarioConfig } from "@/lib/schemas/types";

// Mirrors MOVEMENT_PROFILE_TIME_MULTIPLIER in backend/app/simulation/engine.py.
// Used only to tell "slow because congested" from "slow because of mobility".
const PROFILE_MULTIPLIER: Record<string, number> = { standard: 1.0, reduced_mobility: 1.6 };

interface Leg {
  /** Street path walked on this leg, in walking order (first point = where the leg starts). */
  path: LatLon[];
  to: LatLon;
  entry: number;
  /** Last tick spent on this edge; null = still on it when the run hit max_ticks. */
  exit: number | null;
  freeFlowTicks: number;
}

interface AgentTrack {
  id: string;
  origin: LatLon;
  destination: LatLon | null;
  legs: Leg[];
  /** Roads on the planned route; more than legs.length = still in line for the next one. */
  routeLength: number;
  departureTick: number;
  arrivalTick: number | null;
  shelterId: string | null;
}

export interface Replay {
  tracks: AgentTrack[];
  /** Final tick of the run: last arrival/exit, or max_ticks when the run was cut off. */
  lastTick: number;
}

export interface AgentFrame {
  id: string;
  lat: number;
  lon: number;
  /** "waiting": at its zone until its departure wave (staged plans only). */
  status: AgentStatus;
}

/** Precompute each agent's legs (in walking order — roads are undirected) once per run. */
export function buildReplay(scenario: ScenarioConfig, run: RunResult): Replay {
  const nodes = new Map(scenario.nodes.map((n) => [n.id, [n.lat, n.lon] as LatLon]));
  const nodeById = new Map(scenario.nodes.map((n) => [n.id, n]));
  const edges = new Map(scenario.edges.map((e) => [e.id, e]));
  const zoneNode = new Map(scenario.zones.map((z) => [z.id, z.connectorNode]));
  const shelterNode = new Map(scenario.shelters.map((s) => [s.id, s.connectorNode]));
  const { tickSeconds, maxTicks } = scenario.defaultParams;

  let lastTick = 0;
  const tracks = run.agents.map((agent): AgentTrack => {
    const originId = zoneNode.get(agent.originZone);
    let current = originId;
    const legs: Leg[] = [];
    agent.edgeEntryTicks.forEach((entry, i) => {
      const edge = edges.get(agent.routeEdgeIds[i]);
      if (!edge || !current) return;
      const next = edge.source === current ? edge.target : edge.source;
      const exit = agent.edgeExitTicks[i] ?? null;
      const multiplier = PROFILE_MULTIPLIER[agent.movementProfile] ?? 1;
      const path = roadPath(edge, nodeById.get(edge.source)!, nodeById.get(edge.target)!);
      legs.push({
        path: edge.source === current ? path : [...path].reverse(), to: nodes.get(next)!, entry, exit,
        freeFlowTicks: Math.max(1, Math.round((edge.baseTravelTimeS * multiplier) / tickSeconds)),
      });
      lastTick = Math.max(lastTick, exit ?? entry);
      current = next;
    });
    if (agent.arrivalTick != null) lastTick = Math.max(lastTick, agent.arrivalTick);
    const shelterNodeId = agent.assignedShelter ? shelterNode.get(agent.assignedShelter) : undefined;
    return {
      id: agent.id,
      origin: nodes.get(originId ?? "") ?? [0, 0],
      destination: shelterNodeId ? nodes.get(shelterNodeId) ?? null : null,
      legs,
      routeLength: agent.routeEdgeIds.length,
      departureTick: agent.departureTick ?? 0,
      arrivalTick: agent.arrivalTick ?? null,
      shelterId: agent.status === "arrived" ? agent.assignedShelter ?? null : null,
    };
  });

  return { tracks, lastTick: run.metrics.hitTickLimit ? maxTicks : lastTick };
}

/** Stable pseudo-random in [-1, 1] per agent, so a crowd spreads across the road the same way every frame. */
function jitterFor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return ((hash >>> 0) % 2001) / 1000 - 1;
}

// ~55 m either side of the centre line. Spread is only ever *across* the
// road — spreading along it would misstate where agents are in time.
const JITTER_DEGREES = 0.0005;

function frameFor(track: AgentTrack, t: number, lastTick: number, jitter: boolean): AgentFrame {
  if (track.arrivalTick !== null && t >= track.arrivalTick) {
    const [lat, lon] = track.destination ?? track.origin;
    return { id: track.id, lat, lon, status: "arrived" };
  }
  const at = ([lat, lon]: LatLon, status: AgentStatus): AgentFrame => ({ id: track.id, lat, lon, status });
  // Off the roads: waiting for its departure wave, in line for a road (roads
  // let in only their capacity per tick), or finished without a place.
  const offRoad = (where: LatLon, stillGoing: boolean): AgentFrame => {
    if (t < track.departureTick) return at(where, "waiting");
    return at(where, stillGoing && t < lastTick ? "delayed" : "unserved");
  };
  if (track.routeLength === 0) return at(track.origin, "unserved");
  if (track.legs.length === 0 || t <= track.legs[0].entry - 1) return offRoad(track.origin, true);

  // Leg i covers t in (entry - 1, exit]: progress reaches 1 exactly at its exit tick.
  const leg = track.legs.find((l) => t > l.entry - 1 && (l.exit === null || t <= l.exit));
  if (!leg) {
    // Between roads (in line at a junction), or done with every road it got onto.
    const done = track.legs.filter((l) => l.exit !== null && l.exit < t);
    const last = done[done.length - 1];
    // Still has roads to go, or is waiting outside a shelter it will get into.
    const stillGoing = done.length < track.routeLength || track.arrivalTick !== null;
    return offRoad(last.to, stillGoing);
  }

  const elapsed = t - leg.entry + 1;
  // A leg cut off by max_ticks has no known length; never draw it reaching the far node.
  const span = leg.exit === null ? lastTick - leg.entry + 2 : leg.exit - leg.entry + 1;
  const progress = Math.min(1, Math.max(0, elapsed / span));
  const knownSpan = leg.exit === null ? elapsed : span;

  const { point, direction } = pointAlong(leg.path, progress);
  let [lat, lon] = point;
  if (jitter) {
    // Perpendicular to the street segment the agent is on.
    const offset = jitterFor(track.id) * JITTER_DEGREES;
    lat += -direction[1] * offset;
    lon += direction[0] * offset;
  }

  let status: AgentFrame["status"] = knownSpan > leg.freeFlowTicks ? "delayed" : "moving";
  if (leg.exit === null && t >= lastTick) status = "unserved";
  return { id: track.id, lat, lon, status };
}

export function framesAt(replay: Replay, t: number, { jitter = true }: { jitter?: boolean } = {}): AgentFrame[] {
  return replay.tracks.map((track) => frameFor(track, t, replay.lastTick, jitter));
}

export function countsAt(replay: Replay, t: number): Record<AgentFrame["status"], number> {
  const counts = { waiting: 0, arrived: 0, moving: 0, delayed: 0, unserved: 0 };
  for (const frame of framesAt(replay, t, { jitter: false })) counts[frame.status] += 1;
  return counts;
}

export function occupancyAt(replay: Replay, t: number): Record<string, number> {
  const occupancy: Record<string, number> = {};
  for (const track of replay.tracks) {
    if (track.shelterId && track.arrivalTick !== null && track.arrivalTick <= t) {
      occupancy[track.shelterId] = (occupancy[track.shelterId] ?? 0) + 1;
    }
  }
  return occupancy;
}

export interface ArrivalsPoint {
  tick: number;
  minutes: number;
  arrived: number;
}

/** Cumulative evacuees in shelter at the end of each tick. */
export function arrivalsSeries(run: RunResult, tickSeconds: number, untilTick?: number): ArrivalsPoint[] {
  const arrivalsByTick = new Map<number, number>();
  let last = 0;
  for (const agent of run.agents as AgentResult[]) {
    if (agent.arrivalTick == null) continue;
    arrivalsByTick.set(agent.arrivalTick, (arrivalsByTick.get(agent.arrivalTick) ?? 0) + 1);
    last = Math.max(last, agent.arrivalTick);
  }
  const end = untilTick ?? last;
  const series: ArrivalsPoint[] = [];
  let cumulative = 0;
  for (let tick = 0; tick <= end; tick++) {
    cumulative += arrivalsByTick.get(tick) ?? 0;
    series.push({ tick, minutes: (tick * tickSeconds) / 60, arrived: cumulative });
  }
  return series;
}

/** The scenario as it stands at tick t: roads that have flooded by then drawn as closed. */
export function scenarioAt(scenario: ScenarioConfig, t: number): ScenarioConfig {
  if (!scenario.edges.some((e) => e.closesAtTick != null && t >= e.closesAtTick)) return scenario;
  return {
    ...scenario,
    edges: scenario.edges.map((e) => (e.closesAtTick != null && t >= e.closesAtTick ? { ...e, status: "closed" } : e)),
  };
}
