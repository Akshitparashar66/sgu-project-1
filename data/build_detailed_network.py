"""Builds the detailed Raj Nagar Extension walking network
(data/network/raj_nagar_extension_detailed.json) from OpenStreetMap.

Every public street in the study area becomes part of the network:
junctions are where streets meet, and each road between two junctions
keeps its real street geometry and length. Walking capacity is estimated
from the street type (usable width x 1.3 people per metre per second).

    python data/build_detailed_network.py            # uses the cached download if present
    python data/build_detailed_network.py --refresh  # downloads again from Overpass

Map data (c) OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).
"""
from __future__ import annotations

import json
import math
import sys
import urllib.parse
import urllib.request
from pathlib import Path

import networkx as nx

HERE = Path(__file__).resolve().parent
CACHE = HERE / "network" / ".cache" / "osm_streets.json"  # git-ignored raw download
SIMPLE = HERE / "network" / "raj_nagar_extension.json"
OUT = HERE / "network" / "raj_nagar_extension_detailed.json"

# Study area: the simple network's junctions plus a margin of roughly 600 m.
SOUTH, NORTH, WEST, EAST = 28.6965, 28.7150, 77.4060, 77.4410
OVERPASS = "https://overpass-api.de/api/interpreter"
QUERY = f"""[out:json][timeout:90];
way["highway"~"^(trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|pedestrian|footway|path)$"]
({SOUTH - 0.01},{WEST - 0.01},{NORTH + 0.01},{EAST + 0.01});
out geom;"""

# Usable walking width in metres by street type (estimates, not a survey).
WIDTH_M = {
    "trunk": 7.0, "trunk_link": 4.0, "primary": 7.0, "primary_link": 4.0, "secondary": 6.0, "secondary_link": 4.0,
    "tertiary": 5.0, "tertiary_link": 4.0, "unclassified": 4.0, "residential": 4.0, "living_street": 3.5,
    "service": 3.0, "pedestrian": 4.0, "footway": 2.0, "path": 1.5,
}
WALKING_SPEED_M_S = 1.3
PEDESTRIAN_FLOW_PER_M_S = 1.3
TICK_SECONDS = 30


def metres(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def inside(p: tuple[float, float]) -> bool:
    return SOUTH <= p[0] <= NORTH and WEST <= p[1] <= EAST


def download() -> list[dict]:
    if CACHE.exists() and "--refresh" not in sys.argv:
        return json.loads(CACHE.read_text(encoding="utf-8"))["elements"]
    print("downloading streets from Overpass...")
    data = urllib.parse.urlencode({"data": QUERY}).encode()
    with urllib.request.urlopen(urllib.request.Request(OVERPASS, data=data), timeout=120) as response:
        raw = response.read()
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_bytes(raw)
    return json.loads(raw)["elements"]


def build() -> dict:
    ways = download()
    point = lambda p: (round(p["lat"], 6), round(p["lon"], 6))  # noqa: E731
    g = nx.Graph()
    for way in ways:
        tags = way.get("tags", {})
        if tags.get("access") in ("private", "no") or tags.get("highway") not in WIDTH_M:
            continue
        pts = [point(p) for p in way.get("geometry", [])]
        for a, b in zip(pts, pts[1:]):
            if a != b and inside(a) and inside(b):
                width = WIDTH_M[tags["highway"]]
                if not g.has_edge(a, b) or g[a][b]["width"] < width:
                    g.add_edge(a, b, width=width, name=tags.get("name") or tags["highway"])
    g = g.subgraph(max(nx.connected_components(g), key=len)).copy()

    # Junctions: where three or more street pieces meet, plus dead ends.
    junctions = sorted(n for n in g.nodes if g.degree(n) != 2)
    ids = {n: f"J{i + 1}" for i, n in enumerate(junctions)}
    names_at: dict[tuple, set[str]] = {n: set() for n in junctions}

    edges, seen = [], set()
    for start in junctions:
        for nxt in g.neighbors(start):
            if (start, nxt) in seen:
                continue
            path, width, names = [start, nxt], g[start][nxt]["width"], {g[start][nxt]["name"]}
            while path[-1] not in ids:
                a, b = path[-2], path[-1]
                c = next(n for n in g.neighbors(b) if n != a)
                width = min(width, g[b][c]["width"])
                names.add(g[b][c]["name"])
                path.append(c)
            seen.add((path[-1], path[-2]))
            seen.add((start, nxt))
            if path[-1] == start:  # a loop back to the same junction adds no route
                continue
            length = sum(metres(a, b) for a, b in zip(path, path[1:]))
            if length < 1:
                continue
            names_at[start] |= names
            names_at[path[-1]] |= names
            named = sorted(n for n in names if n not in WIDTH_M) or sorted(names)
            edges.append({
                "id": f"R{len(edges) + 1}", "source": ids[start], "target": ids[path[-1]],
                "streets": ", ".join(named[:2]), "length_m": round(length), "usable_width_m": width,
                "geometry": [list(p) for p in path],
            })

    nodes = [{"id": ids[n], "lat": n[0], "lon": n[1],
              "label": " × ".join(sorted(x for x in names_at[n] if x not in WIDTH_M)[:2]) or "lane junction"}
             for n in junctions]

    # Where the simple network's zones and shelters are, on the detailed one.
    simple = json.loads(SIMPLE.read_text(encoding="utf-8"))
    simple_nodes = {n["id"]: (n["lat"], n["lon"]) for n in simple["nodes"]}
    by_distance = lambda target: sorted(junctions, key=lambda j: metres(j, target))  # noqa: E731
    places = {
        # Each zone's people live around several nearby junctions, not one point.
        "Z1": [ids[j] for j in by_distance(simple_nodes["N1"])[:3]],
        "Z2": [ids[j] for j in by_distance(simple_nodes["N2"])[:3]],
        "S1": ids[by_distance(simple_nodes["N4"])[0]],
        "S2": ids[by_distance(simple_nodes["N6"])[0]],
        "S3": ids[by_distance(simple_nodes["N5"])[0]],
    }
    return {
        "source": "OpenStreetMap streets within the study area, joined junction to junction. "
                  "Map data (c) OpenStreetMap contributors, ODbL 1.0.",
        "bbox": [SOUTH, WEST, NORTH, EAST],
        "nodes": nodes, "edges": edges, "places": places,
    }


def main() -> None:
    network = build()
    OUT.write_text(json.dumps(network, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT.relative_to(HERE.parent)}: {len(network['nodes'])} junctions, {len(network['edges'])} roads")


if __name__ == "__main__":
    main()
