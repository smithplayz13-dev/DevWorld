// Chronoscope resolution state machine (DESIGN.md section 7).
// Drag coalesces preview requests at 150ms with at most one in flight;
// release requests exact resolution. Stale responses are ignored by
// monotonic sequence; time never resets on zoom.
export type ResolutionPhase = "idle" | "preview" | "exact";

export interface ResolutionController {
  phase: ResolutionPhase;
  lastPreviewAt: number;
  previewInFlight: boolean;
  sequence: number;
}

export function createResolution(): ResolutionController {
  return { phase: "idle", lastPreviewAt: 0, previewInFlight: false, sequence: 0 };
}

/** Should a drag tick issue a preview request now? */
export function shouldPreview(state: ResolutionController, now: number): boolean {
  if (state.previewInFlight) return false;
  if (now - state.lastPreviewAt < 150) return false;
  state.lastPreviewAt = now;
  state.previewInFlight = true;
  state.phase = "preview";
  state.sequence += 1;
  return true;
}

export function finishPreview(state: ResolutionController): void {
  state.previewInFlight = false;
}

/** Release always requests exact resolution with a fresh sequence. */
export function requestExact(state: ResolutionController): number {
  state.previewInFlight = false;
  state.phase = "exact";
  state.sequence += 1;
  return state.sequence;
}

/** Accept a response only if its sequence matches current intent. */
export function isCurrent(state: ResolutionController, sequence: number): boolean {
  return sequence === state.sequence;
}
