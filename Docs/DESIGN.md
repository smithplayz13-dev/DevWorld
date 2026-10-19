# DevWorld — Experience and Visual Design

**Direction:** Stark-inspired personal software command center  
**Specification:** v1.0 · 2026-09-26; design requirements, not an implemented UI  
**Related:** [PRD.md](PRD.md), [ARCHITECTURE.md](ARCHITECTURE.md), [DATA.md](DATA.md)

## 1. The experience

DevWorld should feel like a system Tony Stark would use to inspect an entire software civilization. Picture a dark laboratory display: a huge cyan-lit planet suspended in space, luminous country borders, fine orbital measurement arcs, and a precise amber time control beneath it. Select a country and the system locks on, calculates a smooth flight, and resolves its states, districts, and buildings as you approach.

The feeling is controlled power. Most of the screen is quiet. The globe, selection, and time movement carry the visual energy. Every bright indicator explains an actual state; every number is real. Keep labels and ordinary controls crisp above the scene. The visual hierarchy is globe first, selected location second, time third, supporting tools fourth.

Use this inspiration to create an original DevWorld identity: holographic instruments, technical cutaways, and responsive spatial navigation. DevWorld is the product name throughout. Use original or appropriately licensed visual and sound assets.

Animation ownership is split exactly once (ADR-009): the Three.js scene-engine owns camera and spatial transitions; Motion owns React panel transitions, palette, sheets and layout animation; Anime.js owns selection accents, staged reveals and historical-change sequences. No duplicate render loops or full-screen GPU canvases beyond the single scene.

## 2. Canonical hierarchy

| Software | World representation | Inspection behavior |
|---|---|---|
| GitHub account | World / globe | Orbit and world history |
| Repository | Country | Borders, states, repository history |
| Top-level folder | State | Folder subdivisions |
| Subfolder | City / district | Repeated nested districts |
| File | Building | File outline and history |
| Class / component | Floor | Technical cutaway |
| Function / method | Room | Signature and function history |

Root files sit directly in a country. Top-level functions sit directly in a building. Do not invent folders or classes to make the metaphor fit. A functional component is one floor, not a duplicate floor and room. Unsupported files remain buildings with an “Outline unavailable” state. Directory depth two may be labeled City; deeper folders are Districts. The internal folder type is always `directory`.

## 3. Screen composition

### Desktop command center

The scene dominates the viewport beneath a 64 px header, floating horizontal instruments, a collapsible contextual inspector, and the persistent amber Chronoscope. Orbit framing uses an 88% fitting fraction with an atmosphere margin, constrained by the narrower canvas dimension on portrait screens. The country register floats at left on desktop and becomes a horizontally scrollable tray on mobile.

Framing is computed from real canvas dimensions (`scene/framing.ts`): orbit radius derives from field-of-view so the globe fills the target fraction, and the camera principal point shifts beside an open inspector (`setViewOffset`). Reframing runs on resize and inspector open/close. When nothing is selected a compact floating overview card replaces the inspector panel; on selection the 320 px contextual panel appears. Diagnostics live in a developer disclosure inside the overview, never in the primary status line.

Country geometry uses concentric, elevation-preserving spherical tessellation; independent island centers and sufficient surface subdivision prevent land from sinking into the ocean. The selected hierarchy renders states, districts, files and symbols. Streamed payloads are decoded and checksum-validated in a worker, then rendered as pickable instanced file buildings. Country/state previews retain bounded L2 building detail; detailed floors and rooms remain hierarchy-driven. Stale snapshot/selection responses cannot replace the current scene. Synthetic showcase data is explicitly labeled.

```text
┌────────────────────────────────────────────────────────────────────────┐
│ DEVWORLD       SMITH / WORLD       Search                 Sync  Profile│
│ World › ClassOS › src › components                                     │
│                                                                        │
│ ┌──┐                                               ┌─────────────────┐│
│ │◉ │            .-- orbital measurement arc --.    │ COUNTRY         ││
│ │⌕ │          .'                               '.  │ ClassOS         ││
│ │≋ │         /       GIANT HOLOGRAPHIC GLOBE       \ │ Repository      ││
│ │  │        |           [selected country]        |│                 ││
│ └──┘         \                                   / │ 42 buildings    ││
│               '.                               .'  │ Indexed 2m ago  ││
│                  '---------------------------'     │ Explore states  ││
│                                                    └─────────────────┘│
│ ┌─ CHRONOSCOPE · World · Exact ────────────────────────────────────────┐│
│ │ ◀  ▶  ──────│────·────────◆──────────│────────────── Now             ││
│ │              18 JUN 2026             Scope: World / Follow selection ││
│ └────────────────────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────────────────┘
```

The drawing illustrates layout, not measured data. Demo metrics come from synthetic fixtures.

| Element | Layout and purpose |
|---|---|
| Top bar | 56 px tall; wordmark, world name, integrated breadcrumbs, search, inspector, motion |
| Breadcrumbs | Inline scrollable row in the header; software names, world-type tooltip |
| Globe | Full scene canvas behind accessible DOM controls; ~78% globe height |
| Instrument rail | 56 px wide; atlas, overview, ascend — one active overlay initially |
| Inspector | 320 px (300 px under 1200 px viewport); clipped-corner panel; collapses to overview; Motion enter/exit/layout |
| Chronoscope | Persistent bottom instrument, 88 px tall (64 px compact); 20 px outer gutter |
| Status | One-line snapshot state plus low/full detail toggle; diagnostics in inspector |

Use opacity and spacing to subordinate inactive tools. Do not surround the globe with unrelated statistics or a grid of dashboard cards. Search is a command palette that locates entities, not an AI chat requirement.

### Responsive behavior

At 768–1199 px, collapse the inspector by default and reduce orbital decoration. Under 768 px, use a bottom-sheet inspector, 64 px compact timeline, safe-area insets, and a top breadcrumb sheet. The collapsed inspector leaves at least 55% of the viewport for the scene. The timeline remains reachable while a sheet is expanded.

One-finger drag rotates in orbit and pans near the surface; pinch changes scale; two-finger twist rotates the local view. Show on-screen zoom, ascend, and overview controls. Disable conflicting page scrolling only over the active canvas gesture area. Support portrait, landscape, and 200% text zoom.

## 4. Visual system

### Palette

| Token | Value | Role |
|---|---|---|
| `--dw-space` | `#030A12` | Deep navy background |
| `--dw-space-soft` | `#06121D` | Alt background wash |
| `--dw-surface` | `#091823` (95% opaque) | Instrument panels and sheets |
| `--dw-surface-raised` | `#112738` | Menus and active controls |
| `--dw-surface-sunken` | `#050E16` | Inputs and wells |
| `--dw-text` | `#EAF7FF` | Primary text |
| `--dw-text-muted` | `#9DB8C7` | Readable secondary text |
| `--dw-text-faint` | `#647F8E` | Tertiary captions only |
| `--dw-cyan` | `#55DEFF` | Focused geometry and main actions |
| `--dw-cyan-dim` | `#246075` | Decorative grid and inactive rules |
| `--dw-cyan-ghost` | `#55DEFF22` | Selected-control wash |
| `--dw-amber` | `#FFC16A` | Historical cursor and modifications |
| `--dw-amber-ghost` | `#FFC16A22` | History-control wash |
| `--dw-added` | `#84E2B8` | Added entities, with + icon |
| `--dw-removed` | `#FF8999` | Removed entities, with − icon |
| `--dw-focus` | `#FFFFFF` | Keyboard outer focus ring |

Radii are 3 px controls / 6 px sheets; elevation is two restrained shadow steps; panel motion is 180–250 ms `cubic-bezier(0.2, 0.8, 0.2, 1)` owned by Motion. Full token list lives in `apps/web/src/styles/tokens.css`, which is the normative token source.

Use cyan/amber as foregrounds on dark surfaces; filled accent buttons use dark text. Verify composed contrast, including alpha and scene backgrounds. Dim grid lines are decoration, never the only edge of an interactive control. Panels are nearly opaque; holographic transparency belongs primarily to the globe.

Language colors occupy small material bands and optional biome overlays. Preserve cyan as selection color across all languages. High-contrast mode adds patterns and solid borders. Avoid a rainbow globe in the default view.

### Type, spacing, and shape

- Display: locally bundled **Rajdhani SemiBold**, fallback `system-ui`, for DEVWORLD and short instrument headings. Fonts are not yet bundled (no licensed assets in repo); the system-ui fallbacks are the dependable current rendering and must remain usable.
- Body: **IBM Plex Sans**, fallback `system-ui`, 14–16 px, line height 1.45–1.6.
- Code/time: **IBM Plex Mono**, fallback `monospace`, tabular numerals, 12–13 px minimum for functional data.
- Inspector heading: 22–26 px. Small instrument labels: 11–12 px, 0.08em tracking, with larger accessible names.
- Spacing scale: 4/8/12/16/24/32 px. Compact instruments render at 32 px height with a 44×44 px hit area via extended pseudo-element targets.
- Corners: 2–4 px on controls; one 8 px clipped corner on instrument panels (square bottom-sheet on mobile). Maintain rectangular hit targets and visible focus outlines.
- Use 1 px technical rules and sparse corner brackets. One restrained glow per selected object; no blurred body text. No postprocessing bloom pass in the current build; selection glow is material opacity plus rim light.
- Bundle font license files. System fallbacks must remain usable while fonts load.

### Globe materials and lighting

Use a dark standard-material sphere (one directional key + ambient fill) for surface depth, a sparse dim ocean grid, a subtle cyan BackSide rim shell, and translucent spherical country regions with real border loops. Selected regions use a brighter fill, full-bright border and a reticle ring plus a one-shot boundary sweep. Give land solid depth under luminous edges so silhouettes remain readable. Place two broken orbital arcs around the globe, with sparse ticks and correct behind-globe occlusion. Atmospheric glow is a lightweight CSS radial gradient behind the transparent canvas — no second GPU canvas — and is subdued in low-detail mode.

Country angular radius derives from clamped logarithmic source bytes. Coastlines use seeded boundary noise and independently tessellated islands with modest elevation. Concentric radial subdivisions keep triangle interiors above the opaque globe. Relief, survey lines, orbital rings and building light bands are decorative—not fabricated source entities. Small repositories remain reachable through the register, search and DOM atlas.

Buildings use one InstancedMesh per architectural archetype (tower, block, slab, spire, hall + tower setbacks): single-digit draw calls for hundreds of files. Archetype derives from file type and capped metrics; language tints stay inside the cyan/mint family with cyan reserved for selection. At orbit each country shows an aggregated settlement glimpse (seeded points scaled by region size, labeled decorative); individual buildings resolve on descent. Floors and rooms build only for the inspected building. No dependency roads exist in MVP: the backend carries no dependency edges, and the scene must not imply relationships without data.

## 5. Semantic zoom

Semantic levels are `world`, `country`, `state`, `district`, `building`, `floor`, and `room`. Repeated subfolder depths reuse district presentation. LOD tile codes in DATA.md are separate from camera level.

Initial screen-space tuning: prefetch a selected child's detail above 120 CSS px, reveal above 180 px, hide below 130 px. Separate entry and exit thresholds prevent flicker. Clamp by viewport; a click explicitly enters a level even for a small object. Thresholds are tuning defaults to test, not universal constants.

| Level | Scene and content |
|---|---|
| World | Entire globe, country borders, selected names, one factual activity metric |
| Country | Curved horizon, states, current repository summary, captured revision |
| State | Cities/districts, structural density, activity overlay |
| District | Buildings, file-type materials, optional simplified dependency roads |
| Building | Technical cutaway, actual classes/components as floors |
| Floor | Rooms for methods/nested functions; clipped floor geometry stays legible |
| Room | Function marker and owner-only metadata/preview controls |

On country selection, run one boundary sweep and a brief target reticle. Nearby countries dim without disappearing. At the surface, preserve the sense of planetary curvature; transition into a local tangent coordinate frame gradually. Root-file buildings remain reachable without a state.

Building footprint encodes clamped source bytes; base height encodes clamped source lines. Inspection geometry then exposes actual symbols. Explain these encodings in the inspector; height is not a code quality or developer productivity score. Archived countries use dormant illumination and an “Archived” badge.

## 6. Camera choreography

The camera has separate current, target, and navigation states. Use quaternion interpolation for orientation and a curved approach constrained outside the globe. Near a building, use its local up vector. Prevent pole flips and ground clipping. The final pose is derived from bounds plus the available safe view rectangle.

Initial orbit radius is computed from field-of-view so the globe fills the target fraction of the real canvas (`orbitRadiusFor`); selection distances come from `targetRadiusFor` per semantic level. The inspector offset applies through the camera view offset, reframed on resize and panel open/close. One camera controller owns all of this; DOM panels never drive the camera except through flight intents.

| Transition | Initial duration | Visual cue |
|---|---|---|
| Orbit → country | 850 ms | Reticle, boundary confirmation, curved descent |
| Country → state | 650 ms | State perimeter resolves; horizon recedes |
| District → building | 450 ms | Building outline strengthens |
| Building → floor/room | 300 ms | Controlled technical cutaway |
| Very distant jump | Up to 1,100 ms | Brief pull-back then safe approach |
| Inspector open/close | 180–220 ms | Small translation plus opacity |
| Hover/focus | 80–120 ms | Edge and concise label |
| Historical state change | 350–600 ms | Amber sweep over actual changed geometry |

Use elapsed time rather than frame counts. Decelerate without bounce or overshoot. Pointer input interrupts a flight immediately, cancels irrelevant prefetch, and retains the current valid pose. Entering another entity starts from that pose. Browser Back/Forward restores selection, time, overlay, and camera framing.

Reduced motion uses immediate positioning and at most 120 ms opacity changes. Remove rotation, parallax, sweeps, and moving history ghosts. The default idle scene comes to rest for battery life. A user-controlled showcase mode may add slow rotation; it is off by default and pauses when the tab is hidden.

Audio is off by default. If enabled later, use short original selection/time cues under 200 ms. No autoplay voice, alarm loop, or background hum. No AI assistant or voice feature is required for this visual direction.

## 7. Chronoscope: the persistent time machine

Label the instrument **Chronoscope**, with the helper text “Explore code history.” MVP has one cursor, Now, Previous/Next change, Play/Pause, date input, scope pin, and a resolution badge. Display branch information but disable alternate-branch selection until the post-MVP capability is enabled.

The track is a data visualization: per-bucket change bars, amber event-marker diamonds with tooltips, a coverage reference band for the indexed interval, and an amber projection playhead with a diamond handle. A single transparent range input stretched over the track owns all pointer, touch and keyboard interaction (with an accessible value description); the SVG beneath is purely visual. A themed date popover hosts the native date input plus an exact-resolve action. Badges carry tooltips explaining exact/preview/partial in plain language.

During drag, coalesce preview requests at 150 ms intervals and keep at most one active preview request. On release, request exact selected-commit resolution. Cancel or ignore stale responses by a monotonically increasing client request sequence. Never reset time merely because the user zooms.

Resolved history visibly changes the civilization: added entities flash mint, modified entities flash amber, removed entities leave a fading outline ghost at their last known position — all settling into the exact resolved snapshot. Identity for moves comes from entity versions, compared client-side from additive `version_id` fields.

Scope can follow the selection or stay pinned to World. A folder/file scope filters the selected repository snapshot; it does not create an independent revision history. World mode shows one resolved commit per country and highlights missing coverage. Display “Before indexed history” rather than drawing an empty country as if no code existed.

Historical additions grow briefly; deletions appear as outlines only during transition or later compare mode; moves trace one restrained arc. Ambiguous rename matches appear as separate add/delete changes. Every animation settles into the actual resolved state.

Comparison is post-MVP: two handles A/B with explicit added/removed/moved/modified legend. Historical stars, contributor access, issues, and account membership must be labeled “Current” or “Observed since …” unless recorded historically. Git commit dates alone cannot reconstruct these facts.

## 8. Inspector, search, and labels

Every inspector shows the paired terms, such as “Country · Repository” or “Building · File,” the entity name and path, the selected historical time and resolved revision (short OID or honest status), compact metadata rows, navigation actions (ascend, children), and the active visual encoding. Source preview stays owner-gated and bounded. Unsupported or excluded analysis keeps file-level navigation with a plain-language reason. World-level selection shows a compact overview (countries, state, data provenance) plus a developer disclosure with real tile/scene diagnostics. Show full authorized paths in the inspector, but use opaque IDs in URLs. Signature, docstring, and source display follow SECURITY.md.

Search filters the current snapshot by default; a visible toggle expands to indexed historical entities. Search results include the world type, safe path, and existence at the selected time. Enter flies to a result while preserving time. If an entity did not exist then, offer “Go to first indexed appearance.”

Labels are screen-aligned, priority-ordered (selected, focused, then important nearby), greedy collision-placed (`scene/labels.ts`), and occluded when behind the planet. Use at most 100 scene labels on standard desktop and 30 on mobile. A visible hover label is supplemental to a keyboard-accessible tree entry. Truncation must expose the full permitted name through a tooltip and accessible description.

## 9. State language

| State | Presentation |
|---|---|
| Initial indexing | Country silhouettes appear in a published preview version; progress lists completed stages |
| Streaming detail | Keep parent geometry, show one scan edge and loading text |
| Partial history | Hatched coverage region and exact known interval |
| Parser error | Solid building, outline-unavailable reason, file metadata remains navigable |
| Rate limited | Last valid state, retry time if known, retry action |
| Permission revoked | Remove protected geometry/labels and show reconnect only to the owner |
| Offline | Bundled demo is usable; private views request reconnection without saving sensitive data |
| WebGL failure | Switch to the accessible atlas while preserving selection/time |
| Empty account/repository | Calm empty globe/country and an inclusion or demo action |

Use literal messages such as “Indexing 6 of 18 countries” or “History available from 12 March.” Avoid fake completion percentages when total work is unknown. A first-use three-step tour demonstrates country, building, and history; skippable and shown again only on request.

## 10. Accessibility and performance

The DOM atlas mirrors hierarchy, search, inspector, and time controls. It is a complete alternate experience, not just an error screen. Up/Down move through tree rows, Right expands, Left collapses or focuses the parent, Enter flies, with cursor-based “Load more” for large districts. Provide visible Ascend and Overview buttons. `/` opens search and `T` focuses time only outside text fields. Escape cancels flight or closes the topmost dismissible panel; preserve normal browser navigation shortcuts.

A compact scene legend (country/state/building/floor/room swatches, added/modified marks, dressing honesty) sits bottom-right on desktop; a selection leader line links the selected region to its label. Altitude and LOD report in the status line when zoomed; frame time, draw calls and triangles sample into the developer diagnostics honestly (renderer info, no invented VRAM readings).

Meet WCAG 2.2 AA for controls and content. Announce selected type/name/time and completion through a polite live region; do not announce every animation frame. Focus stays on the initiating control unless the user deliberately opens a dialog. Keyboard focus on the 3D canvas renders as an intentional inset cyan instrument ring (`canvas:focus-visible`), never a default white box. Supply reduced motion/effects, high contrast, text scaling, and non-color change markers. Reduced motion makes flights immediate, disables sweeps/pulses/reveals (accent helpers no-op; Motion covered by the media query), and caps the Chronoscope playhead to opacity changes. Background tabs pause the render loop; a low-detail mode (≤300K-triangle class geometry, pixel ratio 1.0, 30 labels) preserves complete navigation. [WCAG 2.2 reference](https://www.w3.org/TR/WCAG22/).

| Profile | Geometry | Draw calls | Resident decoded scene budget |
|---|---|---|---|
| Standard desktop | ≤1.5M triangles | ≤200 | ≤256 MiB CPU+estimated GPU geometry/textures |
| Mobile/low | ≤300K triangles | ≤100 | ≤96 MiB CPU+estimated GPU geometry/textures |

These exclude the browser engine itself; measure whole-tab growth separately. Cap pixel ratio at 1.5 desktop and 1.0 low mode initially. Instanced buildings, shared materials, frustum culling, and worker decoding support the budgets. Evict least-needed detail before dropping interaction responsiveness. Quality reduces atmosphere/bloom/labels before removing hierarchy access. See TESTING.md for hardware and frame-time targets.

## 11. Visual acceptance review

Review six fixed frames: orbit, selected country, state/district, building cutaway, room inspector, and historical rewind. At desktop and mobile sizes, verify the globe's dominance, readable cyan/amber hierarchy, visible time controls, no overlapping labels, and correct software-to-world mapping.

Capture motion clips for orbit descent, interrupted navigation, rapid timeline scrubbing, and reduced-motion equivalents. Test a sparse account and a dense monorepo. A still image is insufficient proof of interaction quality. The Stark-inspired direction passes only when the system feels precise and responsive while remaining readable at ordinary laptop sizes.

## 12. Library responsibilities and references

One owner per animated property (ADR-009): Three.js owns the scene and camera; Motion (`motion/react`) owns panel transitions, command palette, tour, sheets and layout animation; Anime.js v4 (`animate`, `stagger`) owns selection accents, staged boot reveals and playhead pulses. Verified package APIs before integration; versions pinned in the frontend lockfile.

Borrowed patterns, implemented originally in DevWorld tokens (no copied code): Skiper UI's command-palette density (SearchPalette; Skiper ships as a paid shadcn registry, not an npm package); Bklit's data-viz utility vocabulary for the Chronoscope track (bucket bars, marker diamonds, coverage reference band, projection playhead, labeled marks); Refero-grade composition density as an aspiration. The ShaderGradient package was evaluated and rejected — its R3F fullscreen-canvas runtime would add a second render loop for a decorative layer; atmosphere is original CSS gradients instead.
