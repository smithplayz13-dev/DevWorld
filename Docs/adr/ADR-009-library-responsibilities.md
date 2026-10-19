# ADR-009 — Frontend library responsibilities (redesign)

- Status: accepted (2026-09-26, interface rebuild)
- Context: ADR-008 chose plain Three.js + native controls + CSS transitions
  for the first slice. The redesign needs coordinated panel motion, accent
  sequences and a data-dense timeline without duplicate render loops.
- Decision (one owner per animated property):
  - **Three.js scene-engine** (plain, no R3F runtime): globe rendering,
    country regions, camera flights, buildings, spatial transitions. One
    elapsed-time camera controller; one rAF loop with demand rendering.
  - **Motion** (`motion/react`): React panel transitions (inspector
    enter/exit/layout), command palette, tour, bottom sheets and layout
    animation. Verified API: `motion.*`, `AnimatePresence`, `layout` prop.
  - **Anime.js v4** (`animate`, `stagger`): coordinated selection accents
    (inspector edge flash), staged boot reveals and historical-change
    sequences (playhead pulse). Verified via official v4 docs; pinned at 4.5.0.
  - **Atmosphere**: original lightweight CSS radial gradients. The
    ShaderGradient package was evaluated and rejected: it couples to an
    R3F fullscreen-canvas runtime, which would add a second render loop and
    violate the one-controller rule for a purely decorative layer.
  - **Skiper UI / Bklit**: no npm packages exist (registry 404s); both are
    gallery/registry sites. Borrowed patterns only, implemented originally
    in DevWorld tokens: Skiper's command-palette density (SearchPalette) and
    Bklit's data-viz utility vocabulary for the Chronoscope track (bucket
    bars, marker diamonds, coverage reference band, projection playhead,
    every mark labeled). No code copied.
  - **Refero**: public gallery returned no scrapable content; used as a
    composition/density aspiration only, no artifact adopted.
- Rationale: declarative DOM motion (Motion) + imperative accent sequences
  (Anime.js) + single scene controller (Three.js) gives each animated
  property exactly one owner with no overlapping runtimes.
- Consequences: `apps/web` depends on `motion` and `animejs`; reduced-motion
  disables both (helpers no-op, Motion respects the media query via CSS).
  Revisit if a second 3D scene ever justifies R3F.
