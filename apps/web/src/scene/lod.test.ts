import { describe, expect, it } from "vitest";
import { levelForDistance, lodForLevel, shouldSwitchLevel } from "../scene/lod";

describe("semantic zoom bands", () => {
  it("maps orbit distance to world and surface distance to room", () => {
    expect(levelForDistance(4)).toBe("world");
    expect(levelForDistance(2.6)).toBe("country");
    expect(levelForDistance(1.4)).toBe("building");
    expect(levelForDistance(1.05)).toBe("room");
  });

  it("maps camera levels to LOD tile codes, not folder depth", () => {
    expect(lodForLevel("world")).toBe("L0");
    expect(lodForLevel("state")).toBe("L1");
    expect(lodForLevel("building")).toBe("L2");
    expect(lodForLevel("room")).toBe("L3");
  });

  it("applies hysteresis so tiny movements do not oscillate", () => {
    // Adjacent band with a <4% margin must not switch.
    expect(shouldSwitchLevel("country", "state", 2.21)).toBe(false);
    // Distant jumps always switch.
    expect(shouldSwitchLevel("world", "building", 1.4)).toBe(true);
  });
});
