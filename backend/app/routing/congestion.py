from __future__ import annotations

from app.models.schemas import ScenarioConfig, SimulationParams
from app.simulation.protocols import CongestionModelProtocol  # NOT from app.simulation.engine — see master plan §3.4


class CongestionModel(CongestionModelProtocol):
    """Capacity-ratio congestion model (PRD §6.6). Documented formula, not
    a validated real-traffic model:

        ratio = agents_entering_this_tick / edge.capacity_per_tick
        factor = 1.0                              if ratio <= 1.0
                 1.0 + (ratio - 1.0) * PENALTY     otherwise
        effective_time_s = edge.base_travel_time_s * factor
    """

    PENALTY = 1.5  # tunable; documented here, not buried in a magic number elsewhere

    def __init__(self, scenario: ScenarioConfig, params: SimulationParams):
        self._edges_by_id = {e.id: e for e in scenario.edges}
        self._peak: dict[str, tuple[float, int]] = {}

    def _ratio(self, edge_id: str, agents_entering: int) -> float:
        edge = self._edges_by_id[edge_id]
        if edge.capacity_per_tick <= 0:
            return 0.0
        return agents_entering / edge.capacity_per_tick

    def effective_travel_time_s(self, edge_id: str, tick: int, agents_entering: int) -> float:
        edge = self._edges_by_id[edge_id]
        ratio = self._ratio(edge_id, agents_entering)
        factor = 1.0 if ratio <= 1.0 else 1.0 + (ratio - 1.0) * self.PENALTY
        return edge.base_travel_time_s * factor

    def register_tick(self, edge_id: str, tick: int, agents_entering: int) -> None:
        ratio = self._ratio(edge_id, agents_entering)
        prev_ratio, _ = self._peak.get(edge_id, (-1.0, tick))
        if ratio > prev_ratio:
            self._peak[edge_id] = (ratio, tick)

    def peak_congestion(self) -> dict[str, tuple[float, int]]:
        return dict(self._peak)
