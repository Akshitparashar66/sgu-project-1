class CongestionModelProtocol:
    """Structural contract between Member 1's simulation loop and Member
    2's congestion model. Lives here — not in engine.py, not in
    congestion.py — specifically so neither of those two modules has to
    import the other."""

    def entry_capacity(self, edge_id: str) -> int:
        """People who may start along the edge in one tick; the rest wait in line."""
        raise NotImplementedError

    def travel_time_s(self, edge_id: str) -> float:
        """Walking time along the edge once on it (before the movement-profile multiplier)."""
        raise NotImplementedError

    def register_tick(self, edge_id: str, tick: int, demand: int) -> None:
        """Record how many wanted to start along the edge this tick (in line included)."""
        raise NotImplementedError

    def peak_congestion(self) -> dict[str, tuple[float, int]]:
        raise NotImplementedError
