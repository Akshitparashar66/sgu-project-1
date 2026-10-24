import pytest


@pytest.fixture(autouse=True)
def isolated_imports(monkeypatch, tmp_path_factory):
    """Imported scenarios and saved plans go to throwaway folders, so tests
    never see or write a planner's real data in data/imported/ or data/plans/."""
    monkeypatch.setenv("AEGIS_IMPORTED_DIR", str(tmp_path_factory.mktemp("imported")))
    monkeypatch.setenv("AEGIS_PLANS_DIR", str(tmp_path_factory.mktemp("plans")))
    monkeypatch.setenv("AEGIS_RIVER_STATE", str(tmp_path_factory.mktemp("river") / "state.json"))
    monkeypatch.delenv("AEGIS_RIVER_FEED_URL", raising=False)
