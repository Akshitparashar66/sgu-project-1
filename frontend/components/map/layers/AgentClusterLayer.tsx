import { CircleMarker, Tooltip } from "react-leaflet";

import { clusterRadius, clusterResolvedAgents } from "@/lib/map/agentClusters";
import { agentMarkerColor } from "@/lib/map/styling";
import type { AgentResult, ScenarioConfig } from "@/lib/schemas/types";
import type { LayerContext } from "./types";

export function AgentClusterLayer({ scenario, agents, nodeById }: Pick<LayerContext, "nodeById"> & {
  scenario: ScenarioConfig;
  agents: AgentResult[];
}) {
  return clusterResolvedAgents(scenario, agents).map((cluster) => {
    const node = nodeById.get(cluster.nodeId);
    if (!node) return null;
    return (
      <CircleMarker
        key={cluster.key}
        center={[node.lat, node.lon]}
        radius={clusterRadius(cluster.count)}
        pathOptions={{ color: agentMarkerColor(cluster.status), weight: 1, fillOpacity: 0.3 }}
      >
        <Tooltip>{cluster.count} agents {cluster.status}</Tooltip>
      </CircleMarker>
    );
  });
}
