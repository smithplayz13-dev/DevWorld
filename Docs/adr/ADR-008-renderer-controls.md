# ADR-008 — M1 renderer and control-kit choices

- Status: accepted (2026-09-26, synthetic vertical slice)
- Context: TECH_STACK.md selects React + Three.js through React Three Fiber
  with selected Drei utilities, Radix primitives and Motion-if-needed.
- Decision:
  - `scene-engine` uses plain Three.js (WebGL2) owned by one elapsed-time
    camera/scene controller, without the R3F reconciler runtime in M1. This
    keeps per-frame transforms out of React state and gives deterministic
    frame control for the interruptible-flight and on-demand rendering
    requirements.
  - Controls use native accessible elements styled with DevWorld CSS tokens
    instead of Radix primitives in M1; DOM motion uses CSS transitions only.
- Rationale: fewer runtimes to verify for the first globe/time-machine slice;
  the LOD worker-decode, disposal and reduced-motion contracts are easier to
  prove against a single render loop.
- Consequences: no R3F/Drei idioms in `apps/web/src/scene`; revisit when a
  second scene (e.g. guided tour or compare mode) justifies declarative
  composition. Accessibility conformance is proven by the DOM atlas and
  keyboard journey, not by widget lineage.
