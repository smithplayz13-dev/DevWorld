# DevWorld renderer takeover — 26 September 2026

## Implemented

- Replaced the coastline triangle fan with concentric spherical tessellation. Regression tests sample triangle interiors and edges to ensure they remain above the opaque globe. Island centers no longer connect to other islands.
- Connected downloaded tiles to visible, pickable instanced file buildings through a checksum-validating worker. Selection/snapshot generations reject stale results. Country/state previews retain bounded building detail rather than being overwritten by surface-only tiles.
- Repaired overlapping showcase country anchors and scope filtering/material kinds in generated tiles. The six-country world is synthetic, not a live GitHub connection.
- Added a country register, stronger type hierarchy, atmosphere, survey overlays and restrained orbital instruments. Existing Motion/Anime.js/Three.js are retained; no extra UI library was installed.
- Fixed drag-release selection, globe-side occlusion, asynchronous camera targets, deep-link framing, duplicate directory descent and ground clearance for buildings. Low-detail changes rebuild scene geometry.
- Added portrait-aware orbit framing; restored the normal browser viewport after checking the narrow layout.
- Follow-up: close views blend into an oblique surface camera with surface-relative upright orientation. File architecture has bounded parcel footprints and decorative facade bands; component files retain tower shapes even when their source is short.

## Verification actually run

- Python: 35 tests passed; targeted Ruff checks passed.
- Frontend: 29 unit tests passed; TypeScript, ESLint and full source formatting checks passed.
- Browser regression: country → state → district, visible streamed buildings, terrain count, and snapshot/selection camera restoration passed.
- Production build passed, with the existing large-JavaScript-chunk warning.
- Manually inspected orbit, country and district views in Brave. Country preview rendered 143 synthetic file buildings.

## Preview

Updated frontend: http://127.0.0.1:5174/

Updated backend: http://127.0.0.1:8001/

The previous 5173/8000 processes were not forcibly terminated. Use the updated preview. Vite accepts `DEVWORLD_API_ORIGIN`; browser tests accept `DEVWORLD_TEST_URL` for an already-running preview.

## Remaining boundaries

This is a renderer repair and visual upgrade, not completion of the full PRD. Live GitHub ingestion is not connected. Fine-grained floor/room presentation, city placement continuity between coarse tiles and inspected hierarchy, and full-device performance still need further design/QA. Only the new affected browser regression was run; the pre-existing browser suite contains older UI assumptions and was not claimed green. No cloud deployment, source upload or commits were performed.

Original takeover backups are in the Codex task folder under `work/takeover-before`.
