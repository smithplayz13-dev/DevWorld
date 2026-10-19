// Collision-aware label placement (DESIGN.md: at most 100 scene labels
// desktop, 30 mobile; occluded labels hide; priority: selected, focused,
// then important nearby entities). Pure and unit-tested.
export interface LabelCandidate {
  id: string;
  text: string;
  x: number; // screen px
  y: number; // screen px
  priority: number; // lower = more important
  behind: boolean;
}

export interface PlacedLabel extends LabelCandidate {
  width: number;
  height: number;
}

const LABEL_HEIGHT = 22;

export function estimateWidth(text: string): number {
  return Math.min(280, text.length * 7 + 16);
}

/** Greedy placement: priority order, reject on overlap or occlusion. */
export function placeLabels(candidates: LabelCandidate[], maxCount: number): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  const ordered = [...candidates].sort((a, b) => a.priority - b.priority);
  for (const candidate of ordered) {
    if (placed.length >= maxCount) break;
    if (candidate.behind) continue;
    const width = estimateWidth(candidate.text);
    const box = {
      left: candidate.x - width / 2,
      top: candidate.y - LABEL_HEIGHT / 2,
      width,
      height: LABEL_HEIGHT,
    };
    let overlaps = false;
    for (const other of placed) {
      const otherBox = { left: other.x - other.width / 2, top: other.y - other.height / 2 };
      if (
        box.left < otherBox.left + other.width &&
        box.left + box.width > otherBox.left &&
        box.top < otherBox.top + other.height &&
        box.top + box.height > otherBox.top
      ) {
        overlaps = true;
        break;
      }
    }
    if (!overlaps) placed.push({ ...candidate, width, height: LABEL_HEIGHT });
  }
  return placed;
}
