// Semantic zoom levels (DESIGN.md section 5). Camera distance decides which
// tile set is needed; LOD tile codes (L0-L3) are separate from camera level.
// Hysteresis (enter above 180px, exit below 130px) prevents flicker; the px
// thresholds are tuning defaults, while distance bands below drive fetch.
export type CameraLevel =
  "world" | "country" | "state" | "district" | "building" | "floor" | "room";

const BANDS: Array<{ level: CameraLevel; maxDistance: number }> = [
  { level: "room", maxDistance: 1.12 },
  { level: "floor", maxDistance: 1.22 },
  { level: "building", maxDistance: 1.45 },
  { level: "district", maxDistance: 1.8 },
  { level: "state", maxDistance: 2.2 },
  { level: "country", maxDistance: 2.9 },
  { level: "world", maxDistance: Number.POSITIVE_INFINITY },
];

export function levelForDistance(distance: number): CameraLevel {
  for (const band of BANDS) {
    if (distance <= band.maxDistance) return band.level;
  }
  return "world";
}

/** Hysteresis guard: only switch when the new level differs by a margin. */
export function shouldSwitchLevel(
  current: CameraLevel,
  candidate: CameraLevel,
  distance: number,
): boolean {
  if (candidate === current) return false;
  const order = BANDS.map((b) => b.level);
  const delta = Math.abs(order.indexOf(candidate) - order.indexOf(current));
  if (delta > 1) return true;
  // Adjacent bands need a 4% margin beyond the boundary to avoid oscillation.
  const boundary = BANDS[Math.min(order.indexOf(candidate), order.indexOf(current))];
  void boundary;
  return Math.abs(distance - nearestBoundary(current, candidate)) / distance > 0.04;
}

function nearestBoundary(a: CameraLevel, b: CameraLevel): number {
  const order = BANDS.map((b) => b.level);
  const idx = Math.min(order.indexOf(a), order.indexOf(b));
  return BANDS[idx].maxDistance;
}

export function lodForLevel(level: CameraLevel): "L0" | "L1" | "L2" | "L3" {
  switch (level) {
    case "world":
      return "L0";
    case "country":
    case "state":
      return "L1";
    case "district":
    case "building":
      return "L2";
    default:
      return "L3";
  }
}
