// Camera choreography math (DESIGN.md section 6). Elapsed-time easing,
// interruptible flights, poses constrained outside the globe. Pure module:
// Three.js objects are constructed by GlobeView from these values.
export type Vec3 = [number, number, number];

export const FLIGHT_DURATION_MS: Record<string, number> = {
  "orbit-country": 850,
  "country-state": 650,
  "district-building": 450,
  "building-room": 300,
  "distant-jump": 1100,
  history: 475,
};

export function flightKind(fromDistance: number, toDistance: number): string {
  if (Math.abs(fromDistance - toDistance) > 1.2) return "distant-jump";
  if (fromDistance > 2.9) return "orbit-country";
  if (fromDistance > 2.2) return "country-state";
  if (fromDistance > 1.45) return "district-building";
  return "building-room";
}

/** Decelerating ease without bounce or overshoot. */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - clamped, 3);
}

/** Great-circle-ish interpolation between two unit-ish directions. */
export function slerpDirection(from: Vec3, to: Vec3, t: number): Vec3 {
  const dot = Math.min(1, Math.max(-1, from[0] * to[0] + from[1] * to[1] + from[2] * to[2]));
  const theta = Math.acos(dot) * easeOutCubic(t);
  if (theta < 1e-6) return t < 0.5 ? from : to;
  const sinTheta = Math.sin(Math.acos(dot));
  const a = Math.sin(Math.acos(dot) - theta) / sinTheta;
  const b = Math.sin(theta) / sinTheta;
  return [a * from[0] + b * to[0], a * from[1] + b * to[1], a * from[2] + b * to[2]];
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * easeOutCubic(t);
}

/** Keep the camera outside the globe with a safety margin. */
export function clampRadius(radius: number, min = 1.08, max = 6): number {
  return Math.min(max, Math.max(min, radius));
}

export function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** Blend from orbit into an oblique surface view, exposing building walls.
 * The offset is tangent to the sphere, so the camera cannot dip below it. */
export function surfaceCameraPose(
  radialPosition: Vec3,
  tangent: Vec3,
  enabled: boolean,
): {
  position: Vec3;
  target: Vec3;
} {
  const radius = Math.hypot(...radialPosition);
  const normal = normalize(radialPosition);
  const t = enabled ? Math.min(1, Math.max(0, (2.15 - radius) / 0.8)) : 0;
  const blend = t * t * (3 - 2 * t);
  const offset = (radius - 1) * 0.8 * blend;
  return {
    position: radialPosition.map((value, index) => value + tangent[index] * offset) as Vec3,
    target: normal.map((value) => value * 1.025 * blend) as Vec3,
  };
}
