import { describe, expect, it } from "vitest";
import {
  boundaryRadius,
  buildLandGeometry,
  hash2,
  landHeight,
  projectLandPositions,
  seedFromId,
  TERRAIN_CLEARANCE,
  valueNoise,
  type CoastSpec,
} from "../scene/geography";
import { frameForCountry } from "./hierarchy";
import { normalize, type Vec3 } from "./cameraMath";

const SPEC: CoastSpec = { seed: seedFromId("entity:test-country"), baseRadius: 0.4 };

describe("procedural geography", () => {
  it("seeds and hashes deterministically", () => {
    expect(seedFromId("abc")).toBe(seedFromId("abc"));
    expect(seedFromId("abc")).not.toBe(seedFromId("abd"));
    expect(hash2(3, 7, 99)).toBeGreaterThanOrEqual(0);
    expect(hash2(3, 7, 99)).toBeLessThan(1);
    expect(valueNoise(1.2, 3.4, 99)).toBe(valueNoise(1.2, 3.4, 99));
  });

  it("builds positive bounded coastlines with bays and headlands", () => {
    const radii = Array.from({ length: 64 }, (_, i) =>
      boundaryRadius(SPEC, (i / 64) * Math.PI * 2),
    );
    expect(Math.min(...radii)).toBeGreaterThan(0);
    expect(Math.max(...radii)).toBeLessThan(SPEC.baseRadius * 1.6);
    // Variation at several scales: not a circle.
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(SPEC.baseRadius * 0.15);
    expect(boundaryRadius(SPEC, 0)).toBe(boundaryRadius(SPEC, Math.PI * 2));
  });

  it("keeps oceans flat and relief modest", () => {
    const anchor: [number, number, number] = [0, 1, 0];
    expect(landHeight(SPEC, anchor, [0, -1, 0], 0.006)).toBe(0);
    const inside = landHeight(SPEC, anchor, [0.05, 0.99, 0.02], 0.006);
    expect(inside).toBeGreaterThan(0);
    expect(inside).toBeLessThanOrEqual(TERRAIN_CLEARANCE + 0.006);
  });

  it("emits consistent triangulated landmasses with islands", () => {
    const geo = buildLandGeometry(SPEC, 72, 0.006);
    expect(geo.positions.length % 3).toBe(0);
    expect(geo.colors.length).toBe(geo.positions.length);
    expect(geo.rim.length % 3).toBe(0);
    expect(geo.islands.length).toBeGreaterThanOrEqual(1);
    const vertexCount = geo.positions.length / 3;
    for (const index of geo.indices) {
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(vertexCount);
    }
    // Rebuilds are identical.
    expect(buildLandGeometry(SPEC, 72, 0.006)).toEqual(geo);
  });

  it("keeps triangle interiors above the ocean, including poles, seams and low LOD", () => {
    const anchors: Vec3[] = [[0, 1, 0], [0, -1, 0], [-1, 0, 0], normalize([0.7, 0.2, 0.6])];
    let minimumRadius = Infinity;
    for (const baseRadius of [0.19, 0.46, 0.62]) {
      for (const segments of [40, 72]) {
        const spec = { ...SPEC, baseRadius };
        const geo = buildLandGeometry(spec, segments);
        for (const anchor of anchors) {
          const points = projectLandPositions(geo.positions, frameForCountry(anchor, baseRadius));
          for (let i = 0; i < geo.indices.length; i += 3) {
            const a = geo.indices[i] * 3,
              b = geo.indices[i + 1] * 3,
              c = geo.indices[i + 2] * 3;
            // Test interiors as well as every edge midpoint: merely checking
            // vertices allowed the original invisible-land regression to pass.
            for (const weights of [
              [1 / 3, 1 / 3, 1 / 3],
              [0.5, 0.5, 0],
              [0, 0.5, 0.5],
              [0.5, 0, 0.5],
            ]) {
              const point = [0, 1, 2].map(
                (axis) =>
                  points[a + axis] * weights[0] +
                  points[b + axis] * weights[1] +
                  points[c + axis] * weights[2],
              );
              minimumRadius = Math.min(minimumRadius, Math.hypot(...point));
            }
          }
        }
      }
    }
    expect(minimumRadius).toBeGreaterThan(1.002);
  });

  it("keeps islands as separate connected surfaces, with no bridges to another center", () => {
    const geo = buildLandGeometry(SPEC);
    const parent = Array.from({ length: geo.positions.length / 3 }, (_, i) => i);
    const root = (v: number): number => (parent[v] === v ? v : (parent[v] = root(parent[v])));
    for (let i = 0; i < geo.indices.length; i += 3) {
      const [a, b, c] = geo.indices.slice(i, i + 3);
      parent[root(b)] = root(a);
      parent[root(c)] = root(a);
    }
    expect(new Set(parent.map((_, i) => root(i))).size).toBe(1 + geo.islands.length);
  });
});
