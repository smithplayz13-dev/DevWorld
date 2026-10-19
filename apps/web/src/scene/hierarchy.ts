// Deterministic hierarchy placement (pure, unit-tested). Every mesh in the
// scene derives its position from stable inputs — country anchor, sibling
// index/total, entity ID — so scrubbing time or re-rendering never moves
// settled geometry. No invented levels: placement only consumes real
// parent/child relations from the API.
import { normalize, type Vec3 } from "./cameraMath";

export interface LocalFrame {
  /** Unit direction of the frame center. */
  normal: Vec3;
  /** Orthonormal tangent axes. */
  u: Vec3;
  v: Vec3;
  /** Tangent-plane half-extent available to children. */
  extent: number;
}

type V3 = [number, number, number];

function sub(a: Vec3, b: Vec3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Stable 0..1 hash for an entity ID (sibling tie-breaks only). */
export function hash01(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return (hash % 10000) / 10000;
}

export function tangentBasis(n: Vec3): { u: Vec3; v: Vec3 } {
  const helper: Vec3 = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(cross(n, helper));
  const v = normalize(cross(n, u));
  return { u, v };
}

export function frameForCountry(anchor: Vec3, angularRadius: number): LocalFrame {
  const normal = normalize(anchor);
  const { u, v } = tangentBasis(normal);
  return { normal, u, v, extent: Math.tan(Math.min(1.2, angularRadius)) };
}

/** Golden-angle spiral slot: deterministic, stable under sibling growth. */
export function gridSlot(index: number, total: number, spread: number): [number, number] {
  if (total <= 1) return [0, 0];
  const radius = spread * Math.sqrt((index + 0.5) / total);
  const angle = index * 2.399963 + 0.7;
  return [radius * Math.cos(angle), radius * Math.sin(angle)];
}

/** Child frame nested inside a parent frame at a sibling slot. */
export function subFrame(
  parent: LocalFrame,
  index: number,
  total: number,
  childExtent: number,
): LocalFrame {
  const [ox, oy] = gridSlot(index, total, parent.extent * 0.55);
  const center = normalize([
    parent.normal[0] + parent.u[0] * ox + parent.v[0] * oy,
    parent.normal[1] + parent.u[1] * ox + parent.v[1] * oy,
    parent.normal[2] + parent.u[2] * ox + parent.v[2] * oy,
  ]);
  const { u, v } = tangentBasis(center);
  return { normal: center, u, v, extent: Math.min(childExtent, parent.extent * 0.5) };
}

/** Point on (or above) the globe for a frame-local tangent offset. */
export function framePoint(frame: LocalFrame, ox: number, oy: number, lift: number): Vec3 {
  const dir = normalize([
    frame.normal[0] + frame.u[0] * ox + frame.v[0] * oy,
    frame.normal[1] + frame.u[1] * ox + frame.v[1] * oy,
    frame.normal[2] + frame.u[2] * ox + frame.v[2] * oy,
  ]);
  return [dir[0] * (1 + lift), dir[1] * (1 + lift), dir[2] * (1 + lift)];
}

/** Angular separation between two directions (containment checks). */
export function angleBetween(a: Vec3, b: Vec3): number {
  const an = normalize(a);
  const bn = normalize(b);
  return Math.acos(Math.min(1, Math.max(-1, dot(an, bn))));
}

export { sub };

/** Country angular radius from clamped logarithmic source bytes. */
export function countryAngularRadius(sourceBytes: number | undefined): number {
  const weight = Math.log1p(Math.max(0, sourceBytes ?? 4096));
  return Math.min(0.62, Math.max(0.19, 0.16 * Math.sqrt(weight)));
}

/** State sub-cap radius inside its country. */
export function stateAngularRadius(countryAngular: number, siblingCount: number): number {
  const raw = (countryAngular / Math.sqrt(Math.max(1, siblingCount))) * 0.62;
  return Math.min(countryAngular * 0.55, Math.max(0.05, raw));
}

/** Building footprint/height from clamped source bytes/lines. */
export function buildingSize(metrics: { source_bytes?: number; source_lines?: number }): {
  w: number;
  h: number;
  d: number;
} {
  const bytes = Math.max(0, metrics.source_bytes ?? 512);
  const lines = Math.max(0, metrics.source_lines ?? 10);
  const w = Math.min(0.09, Math.max(0.022, 0.014 + bytes / 90000));
  const h = Math.min(0.16, Math.max(0.03, 0.02 + lines / 2600));
  return { w, h, d: w };
}
