"""Builds every scenario in data/scenarios/ from the shared Raj Nagar Extension
network (data/network/raj_nagar_extension.json).

All scenarios simulate an evacuation ON FOOT. Travel times and road
capacities are derived here, from each road's real length and estimated
usable width, so every scenario uses exactly the same street model and only
the documented what-if differs. Re-run after changing anything below:

    python data/build_scenarios.py
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
NETWORK = HERE / "network" / "raj_nagar_extension.json"
OUT = HERE / "scenarios"

# Free walking speed of an able-bodied adult in an evacuation (~4.7 km/h).
# Reduced-mobility evacuees are slower by the engine's 1.6x time multiplier
# (~0.8 m/s: elderly, carrying children, using a stick or wheelchair).
WALKING_SPEED_M_S = 1.3
# Peak pedestrian flow through a street cross-section, people per metre of
# usable width per second (crowd-flow literature puts the maximum at ~1.3).
PEDESTRIAN_FLOW_PER_M_S = 1.3
TICK_SECONDS = 30
MAX_TICKS = 240  # 2 hours

# Hazard-routing risk per road (0-1). Steers routes off risky roads when
# travel times are close; never a closure. E2/E3 skirt the hazard area H1.
HAZARD_RISK = {"E1": 0.0, "E2": 0.2, "E3": 0.1, "E4": 0.0, "E5": 0.0, "E6": 0.0, "E7": 0.0}

ZONES = [
    {"id": "Z1", "name": "Hindon Riverside, Sihani", "connector_node": "N1", "evacuee_count": 600,
     "movement_profile": {"standard": 0.8, "reduced_mobility": 0.2}},
    {"id": "Z2", "name": "Raj Nagar Extension Central", "connector_node": "N2", "evacuee_count": 900,
     "movement_profile": {"standard": 0.85, "reduced_mobility": 0.15}},
]
SHELTERS = [
    {"id": "S1", "name": "North RNE School Camp", "connector_node": "N4", "total_capacity": 600, "occupied": 0, "available": True},
    {"id": "S2", "name": "RNE Community Centre", "connector_node": "N6", "total_capacity": 700, "occupied": 0, "available": True},
    {"id": "S3", "name": "NH-9 Bypass Sports Ground", "connector_node": "N5", "total_capacity": 500, "occupied": 0, "available": True},
]
# A localized hazard beside Gaur Cascades Rd, active from the start.
H1 = {"id": "H1", "polygon": [[28.7036, 77.4240], [28.7066, 77.4240], [28.7066, 77.4282], [28.7036, 77.4282]],
      "severity": 0.6, "start_tick": 0, "end_tick": None}
# Hindon floodplain south of the bypass, over the Sihani lanes E7 runs through.
H2_FLOOD = {"id": "H2", "polygon": [[28.6955, 77.4060], [28.7010, 77.4060], [28.7010, 77.4175], [28.6955, 77.4175]],
            "severity": 0.9, "start_tick": 0, "end_tick": None}


def base_edges(network: dict, walking_speed: float = WALKING_SPEED_M_S) -> list[dict]:
    edges = []
    for e in network["edges"]:
        edges.append({
            "id": e["id"], "source": e["source"], "target": e["target"],
            "length_m": e["length_m"],
            "capacity_per_tick": round(e["usable_width_m"] * PEDESTRIAN_FLOW_PER_M_S * TICK_SECONDS),
            "base_travel_time_s": round(e["length_m"] / walking_speed),
            "status": "open",
            "hazard_risk": HAZARD_RISK[e["id"]],
            "geometry": e["geometry"],
        })
    return edges


# Each scenario = the base city plus one documented what-if.
SCENARIOS = [
    {
        "id": "scenario_a_normal", "name": "Normal Conditions",
        "description": "Evacuation on foot of two Raj Nagar Extension neighbourhoods along real streets: "
                       "all roads open, all shelters available.",
    },
    {
        "id": "scenario_b_bridge_closure", "name": "Critical Road Closure",
        "description": "Scenario A with the Gaur Cascades Rd link (E3) closed — the only direct walking route from "
                       "the hazard-side junction to Shelter S1.",
        "closed": ["E3"],
    },
    {
        "id": "scenario_c_shelter_shortage", "name": "Shelter Capacity Shortage",
        "description": "Scenario A with Shelter S1's capacity cut from 600 to 80 (e.g. a failed structural "
                       "inspection) — roads are unaffected.",
        "capacity": {"S1": 80},
    },
    {
        "id": "scenario_d_hindon_flood", "name": "Hindon River Flood",
        "description": "Monsoon flooding of the Hindon floodplain: the low-lying Sihani lanes (E7) are under water, "
                       "the riverside stretch of the bypass (E1) is hazardous, and the riverside population is up "
                       "to 800 as people come home for the evening.",
        "closed": ["E7"], "hazard_risk": {"E1": 0.6}, "zones": {"Z1": {"evacuee_count": 800}},
        "hazards": [H1, H2_FLOOD],
    },
    {
        "id": "scenario_e_night_vulnerable", "name": "Night Evacuation, Vulnerable Population",
        "description": "Same city at night: unlit streets slow everyone to 1.1 m/s, and 40% of evacuees are "
                       "slower walkers (elderly, children, people carrying belongings) instead of 15-20%. Roads and "
                       "shelters are as in Scenario A.",
        "walking_speed": 1.1,
        "zones": {"Z1": {"movement_profile": {"standard": 0.6, "reduced_mobility": 0.4}},
                  "Z2": {"movement_profile": {"standard": 0.6, "reduced_mobility": 0.4}}},
    },
    {
        "id": "scenario_f_compound_failure", "name": "Compound Failure",
        "description": "Two failures at once: the Gaur Cascades Rd link (E3) is closed and the RNE Community Centre "
                       "(S2) loses half its space (350 of 700 places) to storm damage.",
        "closed": ["E3"], "capacity": {"S2": 350},
    },
]


def build(spec: dict, network: dict) -> dict:
    edges = base_edges(network, spec.get("walking_speed", WALKING_SPEED_M_S))
    for e in edges:
        if e["id"] in spec.get("closed", []):
            e["status"] = "closed"
        e["hazard_risk"] = spec.get("hazard_risk", {}).get(e["id"], e["hazard_risk"])
    zones = copy.deepcopy(ZONES)
    for z in zones:
        z.update(spec.get("zones", {}).get(z["id"], {}))
    shelters = copy.deepcopy(SHELTERS)
    for s in shelters:
        s["total_capacity"] = spec.get("capacity", {}).get(s["id"], s["total_capacity"])
        s["available"] = s["id"] not in spec.get("unavailable", [])
    return {
        "id": spec["id"], "name": spec["name"], "description": spec["description"], "synthetic": True,
        "nodes": network["nodes"], "edges": edges, "zones": zones, "shelters": shelters,
        "hazards": spec.get("hazards", [H1]),
        "default_params": {"tick_seconds": TICK_SECONDS, "max_ticks": MAX_TICKS, "random_seed": 42},
    }


def dump(scenario: dict) -> str:
    """One object per line, like the hand-written fixtures, so diffs stay readable."""
    line = lambda obj: json.dumps(obj, ensure_ascii=False)
    out = ["{"]
    for key in ("id", "name", "description", "synthetic"):
        out.append(f'  "{key}": {line(scenario[key])},')
    for key in ("nodes", "edges", "zones", "shelters", "hazards"):
        rows = ",\n".join(f"    {line(item)}" for item in scenario[key])
        out.append(f'  "{key}": [\n{rows}\n  ],')
    out.append(f'  "default_params": {line(scenario["default_params"])}')
    out.append("}")
    return "\n".join(out) + "\n"


def main() -> None:
    network = json.loads(NETWORK.read_text(encoding="utf-8"))
    for spec in SCENARIOS:
        path = OUT / f"{spec['id']}.json"
        path.write_text(dump(build(spec, network)), encoding="utf-8")
        print(f"wrote {path.relative_to(HERE.parent)}")


if __name__ == "__main__":
    main()
