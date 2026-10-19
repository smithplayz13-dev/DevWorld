import { describe, expect, it } from "vitest";
import {
  clampRadius,
  easeOutCubic,
  flightKind,
  normalize,
  slerpDirection,
  surfaceCameraPose,
} from "../scene/cameraMath";

describe("camera choreography", () => {
  it("tilts close views without taking the camera inside the planet", () => {
    for (const radius of [1.24, 1.35, 1.7, 2.32, 4]) {
      const pose = surfaceCameraPose([radius, 0, 0], [0, 0, 1], true);
      expect(Math.hypot(...pose.position)).toBeGreaterThanOrEqual(radius);
      expect(pose.target[0]).toBeLessThanOrEqual(1.025);
    }
    expect(surfaceCameraPose([1.35, 0, 0], [0, 0, 1], true).position[2]).toBeGreaterThan(0.2);
    expect(surfaceCameraPose([3, 0, 0], [0, 0, 1], false)).toEqual({
      position: [3, 0, 0],
      target: [0, 0, 0],
    });
  });
  it("decelerates without overshoot", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
    expect(easeOutCubic(2)).toBe(1);
  });

  it("classifies flights by altitude change", () => {
    expect(flightKind(3.4, 2.6)).toBe("orbit-country");
    expect(flightKind(1.4, 1.2)).toBe("building-room");
    expect(flightKind(4, 1.2)).toBe("distant-jump");
  });

  it("keeps the camera outside the globe", () => {
    expect(clampRadius(0.5)).toBeGreaterThanOrEqual(1.08);
    expect(clampRadius(99)).toBeLessThanOrEqual(6);
  });

  it("interpolates directions along the sphere", () => {
    const from: [number, number, number] = [1, 0, 0];
    const to: [number, number, number] = [0, 0, 1];
    // Endpoints are exact; easing applies inside the interpolation.
    expect(slerpDirection(from, to, 0)).toEqual(from);
    expect(slerpDirection(from, to, 1)).toEqual(to);
    const mid = normalize(slerpDirection(from, to, 0.5));
    expect(Math.hypot(...mid)).toBeCloseTo(1, 5);
    expect(mid[1]).toBeCloseTo(0, 5); // stays in the equatorial plane
    expect(mid[0]).toBeGreaterThan(0);
    expect(mid[2]).toBeGreaterThan(mid[0]); // eased past the midpoint
  });
});
