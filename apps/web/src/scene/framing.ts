// Camera framing math (DESIGN.md composition targets). The globe diameter
// should occupy ~70-85% of the usable scene height; framing derives from
// real canvas dimensions plus the unobstructed area, never fixed constants.
export const GLOBE_FRACTION = 0.88;
const ATMOSPHERE_MARGIN = 1.12;

/** Orbit radius so the globe (with atmosphere margin) fills the fraction. */
export function orbitRadiusFor(fovDegrees: number, globeFraction = GLOBE_FRACTION): number {
  const half = (fovDegrees * Math.PI) / 180 / 2 || 0.001;
  return ATMOSPHERE_MARGIN / (globeFraction * Math.tan(half));
}

/** Horizontal view offset (px) that recenters the globe beside the inspector. */
export function viewOffsetX(
  viewportWidth: number,
  inspectorWidth: number,
  inspectorOpen: boolean,
): number {
  if (!inspectorOpen || viewportWidth <= 0) return 0;
  // Shift the principal point left by half the inspector width so the globe
  // stays centered in the unobstructed area. Clamped to avoid over-shift.
  const shift = inspectorWidth / 2;
  return Math.min(shift, viewportWidth * 0.22);
}

/** Radius band per semantic level for selection framing. */
export function targetRadiusFor(level: string | undefined, viewportHeight: number): number {
  const base = orbitRadiusFor(50);
  void viewportHeight;
  switch (level) {
    case "room":
    case "floor":
      return 1.24;
    case "building":
      return 1.3;
    case "district":
      return 1.35;
    case "state":
      return 1.7;
    case "country":
      return Math.min(2.6, base * 0.85);
    default:
      return base;
  }
}
