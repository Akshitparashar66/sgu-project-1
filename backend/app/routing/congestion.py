from __future__ import annotations

from app.models.schemas import ScenarioConfig, SimulationParams
from app.simulation.protocols import CongestionModelProtocol  # NOT from app.simulation.engine — see master plan §3.4


class CongestionModel(CongestionModelProtocol):
    """Bottleneck (point-queue) model of pedestrian congestion (PRD §6.6).

    A road lets at most `capacity_per_tick` people start along it each tick:
    its usable width times the peak pedestrian flow, over one tick. Everyone
    else waits in line at the junction, longest-waiting first, and walks at
    normal speed once on the road. Congestion therefore shows up as time
    spent queueing, never as a whole crowd slowing down together.

    The reported congestion ratio is demand over capacity: people wanting to
    start along the road in a tick (including those already in line),
    divided by how many it lets in. Documented model, not calibrated to
    observed crowds; see docs/ASSUMPTIONS.md.
    """

    def __init__(self, scenario: ScenarioConfig, params: SimulationParams):
        self._edges_by_id = {e.id: e for e in scenario.edges}
        self._peak: dict[str, tuple[float, int]] = {}

    def entry_capacity(self, edge_id: str) -> int:
        return self._edges_by_id[edge_id].capacity_per_tick

    def travel_time_s(self, edge_id: str) -> float:
        return self._edges_by_id[edge_id].base_travel_time_s

    def register_tick(self, edge_id: str, tick: int, demand: int) -> None:
        capacity = self._edges_by_id[edge_id].capacity_per_tick
        ratio = demand / capacity if capacity > 0 else 0.0
        prev_ratio, _ = self._peak.get(edge_id, (-1.0, tick))
        if ratio > prev_ratio:
            self._peak[edge_id] = (ratio, tick)

    def peak_congestion(self) -> dict[str, tuple[float, int]]:
        return dict(self._peak)
