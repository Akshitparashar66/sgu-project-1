class CongestionModelProtocol:
    """Structural contract between Member 1's simulation loop and Member
    2's congestion model. Lives here — not in engine.py, not in
    congestion.py — specifically so neither of those two modules has to
    import the other."""

    def effective_travel_time_s(self, edge_id: str, tick: int, agents_entering: int) -> float:
        raise NotImplementedError

    def register_tick(self, edge_id: str, tick: int, agents_entering: int) -> None:
        raise NotImplementedError

    def peak_congestion(self) -> dict[str, tuple[float, int]]:
        raise NotImplementedError
