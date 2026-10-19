import { describe, expect, it, vi } from "vitest";
import { createResolution, isCurrent, requestExact, shouldPreview } from "../timeline/resolution";

describe("chronoscope resolution", () => {
  it("coalesces drag previews and releases to exact", () => {
    vi.useFakeTimers();
    const state = createResolution();
    expect(shouldPreview(state, 1000)).toBe(true);
    expect(shouldPreview(state, 1050)).toBe(false); // within 150ms
    expect(shouldPreview(state, 1200)).toBe(false); // one in flight
    const sequence = requestExact(state);
    expect(isCurrent(state, sequence)).toBe(true);
    expect(isCurrent(state, sequence - 1)).toBe(false); // stale ignored
    vi.useRealTimers();
  });
});
