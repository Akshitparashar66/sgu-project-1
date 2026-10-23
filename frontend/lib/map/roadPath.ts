import type { RoadEdge, RoadNode } from "@/lib/schemas/types";

export type LatLon = [number, number];

/** The street path a road is drawn along, source → target. Straight line when the scenario gives no geometry. */
export function roadPath(edge: RoadEdge, source: RoadNode, target: RoadNode): LatLon[] {
  return edge.geometry && edge.geometry.length >= 2
    ? edge.geometry
    : [[source.lat, source.lon], [target.lat, target.lon]];
}

// Longitude degrees shrink with latitude; scale them so "distance along the
// path" is proportional to metres (exact enough at city scale).
function segmentLength(a: LatLon, b: LatLon): number {
  const cosLat = Math.cos((((a[0] + b[0]) / 2) * Math.PI) / 180);
  return Math.hypot(b[0] - a[0], (b[1] - a[1]) * cosLat);
}

/**
 * The point `progress` (0–1) of the way along `path` by distance, and the
 * unit direction of the segment it falls on (for offsetting across the road).
 */
export function pointAlong(path: LatLon[], progress: number): { point: LatLon; direction: LatLon } {
  const lengths = path.slice(1).map((p, i) => segmentLength(path[i], p));
  const total = lengths.reduce((sum, l) => sum + l, 0);
  let remaining = Math.min(1, Math.max(0, progress)) * total;
  for (let i = 0; i < lengths.length; i++) {
    const [a, b] = [path[i], path[i + 1]];
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const f = lengths[i] > 0 ? Math.min(1, remaining / lengths[i]) : 0;
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return {
        point: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f],
        direction: [(b[0] - a[0]) / d, (b[1] - a[1]) / d],
      };
    }
    remaining -= lengths[i];
  }
  return { point: path[0], direction: [0, 0] };
}
