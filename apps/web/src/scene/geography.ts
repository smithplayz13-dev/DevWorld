// Deterministic procedural geography (pure, unit-tested). Coastlines,
// terrain relief and islands derive from entity-ID seeds, so geography is
// stable across navigation, rebuilds and timeline changes. Only the
// *extent* of a region encodes data (clamped logarithmic source bytes);
// coastline wiggle and relief are decorative dressing and are labeled as
// such in the legend — they never imply metrics.
import type { Vec3 } from "./cameraMath";
import { normalize } from "./cameraMath";
import { tangentBasis, type LocalFrame } from "./hierarchy";

// A geometric clearance, not polygonOffset: raycasting and the visible surface
// must agree. Closely spaced vertices keep triangle interiors above the ocean.
export const TERRAIN_CLEARANCE = 0.008;

function elevation(spec: CoastSpec, x: number, z: number, maxElev: number): number {
  const broad = valueNoise(x * 8 + 3, z * 8 + 7, spec.seed);
  const fine = valueNoise(x * 27, z * 27, spec.seed ^ 0x51ed);
  return TERRAIN_CLEARANCE + maxElev * (0.3 + broad * 0.5 + fine * 0.2);
}

export interface CoastSpec {
  seed: number;
  /** Base angular radius in tangent-plane units. */
  baseRadius: number;
}

/** FNV-1a seed from a stable string (entity ID, layout seed). */
export function seedFromId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function hash2(x: number, y: number, seed: number): number {
  let h = (seed ^ Math.imul(x, 0x85ebca6b) ^ Math.imul(y, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in 0..1. */
export function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  const u = s(xf);
  const v = s(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Coastline radius at angle theta: three octaves of variation. */
export function boundaryRadius(spec: CoastSpec, theta: number): number {
  const { seed, baseRadius } = spec;
  const cx = Math.cos(theta);
  const sx = Math.sin(theta);
  const n1 = valueNoise(cx * 1.3 + 7.7, sx * 1.3 + 3.1, seed) - 0.5;
  const n2 = valueNoise(cx * 3.1 + 1.7, sx * 3.1 + 9.2, seed ^ 0x9e3779b9) - 0.5;
  const n3 = valueNoise(cx * 6.7 + 4.3, sx * 6.7 + 5.9, seed ^ 0x85ebca6b) - 0.5;
  return Math.max(baseRadius * 0.42, baseRadius * (1 + 0.36 * n1 + 0.15 * n2 + 0.07 * n3));
}

/**
 * Terrain elevation above the unit sphere for a world direction. Zero
 * outside the country so oceans stay oceans; buildings query this to sit
 * on the surface instead of sinking into relief.
 */
export function landHeight(spec: CoastSpec, anchor: Vec3, dir: Vec3, maxElev: number): number {
  const dot = Math.min(
    1,
    Math.max(-1, anchor[0] * dir[0] + anchor[1] * dir[1] + anchor[2] * dir[2]),
  );
  const ang = Math.acos(dot);
  const edge = spec.baseRadius * 1.3;
  if (ang >= edge) return 0;
  const { u, v } = tangentBasis(anchor);
  const divisor = Math.max(0.001, dot);
  const x = (dir[0] * u[0] + dir[1] * u[1] + dir[2] * u[2]) / divisor;
  const z = (dir[0] * v[0] + dir[1] * v[1] + dir[2] * v[2]) / divisor;
  return elevation(spec, x, z, maxElev);
}

/** Preserve each sampled elevation when wrapping the tessellated land. */
export function projectLandPositions(local: number[], frame: LocalFrame, lift = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < local.length; i += 3) {
    const dir = normalize([
      frame.normal[0] + frame.u[0] * local[i] + frame.v[0] * local[i + 2],
      frame.normal[1] + frame.u[1] * local[i] + frame.v[1] * local[i + 2],
      frame.normal[2] + frame.u[2] * local[i] + frame.v[2] * local[i + 2],
    ]);
    const radius = 1 + local[i + 1] + lift;
    out.push(dir[0] * radius, dir[1] * radius, dir[2] * radius);
  }
  return out;
}

export interface LandGeometry {
  positions: number[];
  colors: number[];
  indices: number[];
  /** Rim loop in local frame (for the coastline LineLoop). */
  rim: number[];
  /** Island centers in local frame (for labels/markers if needed). */
  islands: Array<[number, number, number]>;
}

const LAND_INNER: [number, number, number] = [0.055, 0.19, 0.23];
const LAND_OUTER: [number, number, number] = [0.22, 0.52, 0.49];

function mix(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Concentric tessellation is essential: a single center-to-coast fan cuts
 * through the globe even when all of its vertices are above the water.
 * Each island owns its own center/rings; no cross-island triangles exist.
 */
export function buildLandGeometry(spec: CoastSpec, segments = 72, maxElev = 0.006): LandGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const rim: number[] = [];
  const islands: Array<[number, number, number]> = [];
  function vertex(x: number, z: number): number {
    const index = positions.length / 3;
    positions.push(x, elevation(spec, x, z, maxElev), z);
    colors.push(...mix(LAND_INNER, LAND_OUTER, valueNoise(x * 11, z * 11, spec.seed)));
    return index;
  }
  function region(
    cx: number,
    cz: number,
    radiusAt: (theta: number) => number,
    ringSegments: number,
    rings: number,
    mainland: boolean,
  ): void {
    const center = vertex(cx, cz);
    let previous: number[] = [];
    for (let ring = 1; ring <= rings; ring++) {
      const current: number[] = [];
      for (let i = 0; i < ringSegments; i++) {
        const theta = (i / ringSegments) * Math.PI * 2;
        const r = (radiusAt(theta) * ring) / rings;
        const x = cx + r * Math.cos(theta);
        const z = cz + r * Math.sin(theta);
        current.push(vertex(x, z));
        if (mainland && ring === rings) rim.push(x, elevation(spec, x, z, maxElev) + 0.0015, z);
      }
      for (let i = 0; i < ringSegments; i++) {
        const next = (i + 1) % ringSegments;
        if (ring === 1) indices.push(center, current[next], current[i]);
        else
          indices.push(
            previous[i],
            current[next],
            current[i],
            previous[i],
            previous[next],
            current[next],
          );
      }
      previous = current;
    }
  }
  region(
    0,
    0,
    (theta) => boundaryRadius(spec, theta),
    segments,
    Math.max(4, Math.ceil((spec.baseRadius * 1.4) / 0.025)),
    true,
  );
  // Deterministic nearby islands (decorative, stable).
  const islandCount = 1 + (spec.seed % 3);
  for (let k = 0; k < islandCount; k++) {
    const angle = ((spec.seed >> (k * 5)) % 628) / 100;
    const dist = spec.baseRadius * (1.35 + hash2(k, 7, spec.seed) * 0.5);
    const ir = spec.baseRadius * (0.1 + hash2(k, 13, spec.seed) * 0.09);
    const cx = Math.cos(angle) * dist;
    const cz = Math.sin(angle) * dist;
    islands.push([cx, elevation(spec, cx, cz, maxElev), cz]);
    region(cx, cz, () => ir, 24, Math.max(3, Math.ceil(ir / 0.02)), false);
  }
  return { positions, colors, indices, rim, islands };
}
