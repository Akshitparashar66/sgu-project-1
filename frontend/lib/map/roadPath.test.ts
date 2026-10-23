import { describe, expect, it } from "vitest";
import type { RoadEdge, RoadNode } from "@/lib/schemas/types";
import { pointAlong, roadPath } from "./roadPath";

const source: RoadNode = { id: "N1", lat: 0, lon: 0 };
const target: RoadNode = { id: "N2", lat: 0, lon: 2 };
const edge = { id: "E1", source: "N1", target: "N2" } as RoadEdge;

describe("roadPath", () => {
  it("is a straight line without geometry, and the street path with it", () => {
    expect(roadPath(edge, source, target)).toEqual([[0, 0], [0, 2]]);
    const geometry: [number, number][] = [[0, 0], [1, 0], [1, 2], [0, 2]];
    expect(roadPath({ ...edge, geometry }, source, target)).toBe(geometry);
  });
});

describe("pointAlong", () => {
  // An L-shaped street: 1° north, then 1° east (near the equator, so the legs are ≈ equal length).
  const path: [number, number][] = [[0, 0], [1, 0], [1, 1]];

  it("measures progress by distance along the bends, not as a straight line", () => {
    expect(pointAlong(path, 0).point).toEqual([0, 0]);
    expect(pointAlong(path, 0.25).point[0]).toBeCloseTo(0.5);
    // The east-west leg is at latitude 1°, so it is a hair shorter than the north leg.
    expect(pointAlong(path, 0.5).point[0]).toBeCloseTo(1, 3);
    expect(pointAlong(path, 0.5).point[1]).toBeCloseTo(0, 3);
    expect(pointAlong(path, 0.75).point[1]).toBeCloseTo(0.5);
    expect(pointAlong(path, 1).point).toEqual([1, 1]);
  });

  it("reports the direction of the segment the point is on", () => {
    expect(pointAlong(path, 0.25).direction).toEqual([1, 0]);
    expect(pointAlong(path, 0.75).direction).toEqual([0, 1]);
  });
});
