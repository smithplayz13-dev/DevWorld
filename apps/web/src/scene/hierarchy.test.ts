import { describe, expect, it } from "vitest";
import {
  angleBetween,
  buildingSize,
  countryAngularRadius,
  frameForCountry,
  framePoint,
  gridSlot,
  hash01,
  stateAngularRadius,
  subFrame,
} from "../scene/hierarchy";
import { normalize } from "../scene/cameraMath";

describe("hierarchy placement", () => {
  it("is deterministic per entity and sibling slot", () => {
    const a = gridSlot(2, 7, 0.3);
    const b = gridSlot(2, 7, 0.3);
    expect(a).toEqual(b);
    expect(hash01("same-id")).toBe(hash01("same-id"));
    expect(hash01("a")).not.toBe(hash01("b"));
  });

  it("nests child frames inside their parent extent", () => {
    const parent = frameForCountry(normalize([0.4, 0.5, 0.75]), 0.5);
    for (let i = 0; i < 6; i++) {
      const child = subFrame(parent, i, 6, 0.1);
      expect(angleBetween(parent.normal, child.normal)).toBeLessThan(parent.extent);
      expect(child.extent).toBeLessThanOrEqual(parent.extent * 0.5);
    }
  });

  it("keeps frame points on the globe surface plus lift", () => {
    const frame = frameForCountry(normalize([0, 1, 0]), 0.4);
    const point = framePoint(frame, 0.05, -0.03, 0.02);
    const length = Math.hypot(point[0], point[1], point[2]);
    expect(length).toBeCloseTo(1.02, 2);
  });

  it("sizes countries and states recognizably but bounded", () => {
    const country = countryAngularRadius(20000);
    expect(country).toBeGreaterThan(0.18);
    expect(country).toBeLessThanOrEqual(0.62);
    const state = stateAngularRadius(country, 4);
    expect(state).toBeLessThan(country);
    expect(state).toBeGreaterThan(0);
  });

  it("clamps building footprints and heights", () => {
    const small = buildingSize({ source_bytes: 10, source_lines: 2 });
    const huge = buildingSize({ source_bytes: 10_000_000, source_lines: 500_000 });
    expect(small.w).toBeGreaterThan(0);
    expect(huge.w).toBeLessThanOrEqual(0.09);
    expect(huge.h).toBeLessThanOrEqual(0.16);
    expect(huge.h).toBeGreaterThan(small.h);
  });
});
