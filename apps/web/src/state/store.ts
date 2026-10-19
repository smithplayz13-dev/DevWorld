// Local UI state (Zustand). Server state lives in TanStack Query keyed by
// snapshot; per-frame camera transforms never enter React state.
import { create } from "zustand";
import type { EntityDetail, Selector } from "../api/types";

export type OverlayId = "none" | "activity" | "language";

interface TimelineState {
  selector: Selector;
  precision: "exact" | "preview";
  scopePinned: boolean;
  /** Monotonic client sequence; stale responses are ignored. */
  sequence: number;
}

interface CameraIntent {
  /** Entity to frame, or null for orbit overview. */
  targetEntityId: string | null;
  /** Incremented per navigation so Back/Forward restore framing. */
  flightId: number;
}

interface WorldState {
  worldId: string | null;
  versionId: string | null;
  snapshotId: string | null;
  scopeEntityId: string | null;
  selection: EntityDetail | null;
  breadcrumbs: EntityDetail[];
  timeline: TimelineState;
  camera: CameraIntent;
  overlay: OverlayId;
  inspectorOpen: boolean;
  searchOpen: boolean;
  reducedMotion: boolean;
  lowDetail: boolean;
  webglFailed: boolean;
  pendingTiles: number;
  decodedBytes: number;
  sceneObjects: number;
  sceneBytes: number;
  altitude: string;
  perf: { fps: number; ms: number; calls: number; tris: number } | null;
  announcement: string;
  showTour: boolean;
  set: (patch: Partial<WorldState>) => void;
  bumpSequence: () => number;
  flyTo: (entityId: string | null) => void;
  announce: (message: string) => void;
}

const prefersReducedMotion =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const useWorld = create<WorldState>((set, get) => ({
  worldId: null,
  versionId: null,
  snapshotId: null,
  scopeEntityId: null,
  selection: null,
  breadcrumbs: [],
  timeline: { selector: { type: "latest" }, precision: "exact", scopePinned: false, sequence: 0 },
  camera: { targetEntityId: null, flightId: 0 },
  overlay: "none",
  inspectorOpen: true,
  searchOpen: false,
  reducedMotion: prefersReducedMotion,
  lowDetail: false,
  webglFailed: false,
  pendingTiles: 0,
  decodedBytes: 0,
  sceneObjects: 0,
  sceneBytes: 0,
  altitude: "",
  perf: null,
  announcement: "",
  showTour: typeof localStorage !== "undefined" && !localStorage.getItem("dw-tour-seen"),
  set: (patch) => set(patch),
  bumpSequence: () => {
    const next = get().timeline.sequence + 1;
    set({ timeline: { ...get().timeline, sequence: next } });
    return next;
  },
  flyTo: (entityId) =>
    set({ camera: { targetEntityId: entityId, flightId: get().camera.flightId + 1 } }),
  announce: (message) => set({ announcement: message }),
}));

export function dismissTour(): void {
  try {
    localStorage.setItem("dw-tour-seen", "1");
  } catch {
    /* private mode: tour simply reappears next visit */
  }
  useWorld.getState().set({ showTour: false });
}
