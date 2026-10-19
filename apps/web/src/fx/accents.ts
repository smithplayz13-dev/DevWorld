// Selection accents and staged reveals (Anime.js owns these properties).
// Motion owns panel enter/exit; the camera controller owns scene motion.
// Every helper no-ops under reduced motion.
import { animate, stagger } from "animejs";

function motionAllowed(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Staged boot reveal: rail, header, chronoscope and inspector cascade in. */
export function bootReveal(root: HTMLElement): void {
  if (!motionAllowed()) return;
  const targets = root.querySelectorAll("[data-reveal]");
  animate(targets, {
    opacity: [0, 1],
    translateY: [10, 0],
    duration: 420,
    delay: stagger(70),
    ease: "outCubic",
  });
}

/** Brief cyan edge flash when the inspected entity changes. */
export function inspectorFlash(panel: HTMLElement): void {
  if (!motionAllowed()) return;
  animate(panel, {
    boxShadow: ["0 0 0 1px #55deff", "0 2px 12px rgb(0 0 0 / 45%)"],
    duration: 500,
    ease: "outCubic",
  });
}

/** Amber playhead pulse once an exact snapshot lands. */
export function playheadPulse(handle: HTMLElement): void {
  if (!motionAllowed()) return;
  animate(handle, { scale: [1, 1.35, 1], duration: 450, ease: "outCubic" });
}
