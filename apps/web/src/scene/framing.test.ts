import { describe, expect, it } from "vitest";
import { GLOBE_FRACTION, orbitRadiusFor, targetRadiusFor, viewOffsetX } from "../scene/framing";
import { placeLabels } from "../scene/labels";

describe("camera framing", () => {
  it("sizes the globe to the configured usable scene fraction", () => {
    const radius = orbitRadiusFor(50);
    // Globe angular fraction = margin / (radius * tan(fov/2)).
    const fraction = 1.12 / (radius * Math.tan((50 * Math.PI) / 360));
    expect(fraction).toBeCloseTo(GLOBE_FRACTION, 5);
    expect(radius).toBeGreaterThan(2.4);
    expect(radius).toBeLessThan(3.6);
  });

  it("recenters beside an open inspector and stays put when closed", () => {
    expect(viewOffsetX(1440, 320, false)).toBe(0);
    expect(viewOffsetX(1440, 320, true)).toBe(160);
    expect(viewOffsetX(390, 340, true)).toBeLessThanOrEqual(390 * 0.22);
  });

  it("frames selections inside safe view bounds", () => {
    expect(targetRadiusFor("room", 800)).toBeLessThan(targetRadiusFor("country", 800));
    expect(targetRadiusFor(undefined, 800)).toBeCloseTo(orbitRadiusFor(50), 5);
  });
});

describe("label placement", () => {
  it("prioritizes, occludes and caps labels", () => {
    const placed = placeLabels(
      [
        { id: "a", text: "selected", x: 100, y: 100, priority: 0, behind: false },
        { id: "b", text: "near", x: 104, y: 102, priority: 1, behind: false },
        { id: "c", text: "hidden", x: 400, y: 400, priority: 2, behind: true },
        { id: "d", text: "far", x: 700, y: 100, priority: 3, behind: false },
      ],
      100,
    );
    expect(placed.map((l) => l.id)).toEqual(["a", "d"]);
  });
});
