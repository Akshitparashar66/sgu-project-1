import type { AgentResult, AgentStatus, ScenarioConfig } from "@/lib/schemas/types";

export interface AgentCluster {
  key: string;
  nodeId: string;
  status: AgentStatus;
  count: number;
}

/**
 * Groups resolved agents into one marker per (node, status) — hundreds of
 * identical dots stacked on one point would be unreadable and slow.
 *
 * Arrived agents sit at their assigned shelter's connector node. Roads are
 * undirected, so the last route edge's `target` is not necessarily where an
 * agent ended up — the shelter is. Unserved agents are drawn at their origin
 * zone: AgentResult carries no mid-route position, so "where they started"
 * is the only location we actually know.
 */
export function clusterResolvedAgents(scenario: ScenarioConfig, agents: AgentResult[]): AgentCluster[] {
  const shelterNode = new Map(scenario.shelters.map((s) => [s.id, s.connectorNode]));
  const zoneNode = new Map(scenario.zones.map((z) => [z.id, z.connectorNode]));
  const clusters = new Map<string, AgentCluster>();

  for (const agent of agents) {
    let nodeId: string | undefined;
    if (agent.status === "arrived" && agent.assignedShelter) nodeId = shelterNode.get(agent.assignedShelter);
    else if (agent.status === "unserved") nodeId = zoneNode.get(agent.originZone);
    if (!nodeId) continue;

    const key = `${agent.status}:${nodeId}`;
    const cluster = clusters.get(key) ?? { key, nodeId, status: agent.status, count: 0 };
    cluster.count += 1;
    clusters.set(key, cluster);
  }
  return [...clusters.values()];
}

/** Marker radius in pixels: grows with sqrt(count) so area tracks headcount. */
export function clusterRadius(count: number): number {
  return 6 + Math.sqrt(count) * 1.2;
}
