# DevWorld — Product Requirements Document

**Status:** Implementation specification v1.0 · 2026-09-26; proposed, not yet implemented  
**Product type:** Web-first interactive 3D application  
**Product name:** DevWorld  
**Primary audience:** Individual developers, students, open-source maintainers, educators, and portfolio viewers

## 1. Product summary

DevWorld turns a GitHub account into an explorable software civilization. The account is represented as a world or globe; repositories are countries; top-level folders are states; subfolders are cities or districts; files are buildings; classes and components are floors; and functions are rooms.

The globe is the interface, not a decoration beside a conventional dashboard. A user begins in orbit, selects a country, and the camera smoothly descends through increasingly detailed layers. A persistent timeline lets the user rewind the entire account or the currently selected country, state, city, building, floor, or room to understand how the codebase changed.

The product should make a software portfolio emotionally engaging while remaining useful for codebase discovery, architectural understanding, and historical investigation.

The visual direction is a personal command center worthy of Tony Stark: a monumental holographic globe, precise cyan instrumentation, amber historical changes, and responsive camera flights. [DESIGN.md](DESIGN.md) turns this inspiration into original, implementable interface rules.

## Documentation map and decision ownership

All twelve files form one specification. Start here, then read [DESIGN.md](DESIGN.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [WORKFLOW.md](WORKFLOW.md).

| Document | Authoritative responsibility |
|---|---|
| [PRD.md](PRD.md) | Scope, vocabulary, user outcomes, acceptance criteria |
| [TECH_STACK.md](TECH_STACK.md) | Selected tools, repository structure, runtime choices |
| [SECURITY.md](SECURITY.md) | Access control, source handling, retention, incident response |
| [TESTING.md](TESTING.md) | Fixtures, test matrix, performance and release gates |
| [WORKFLOW.md](WORKFLOW.md) | Build sequence, local setup, CI/CD, operational runbooks |
| [DESIGN.md](DESIGN.md) | Stark-inspired visual system, interaction, motion, accessibility |
| [DATA.md](DATA.md) | Collection, history semantics, transformations, limits, provenance |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Components, trust boundaries, request and job flows |
| [API_SPEC.md](API_SPEC.md) | Versioned HTTP/SSE contracts and errors |
| [DATA_MODEL.md](DATA_MODEL.md) | Entities, keys, relationships, invariants, indexes |
| [AGENTS.md](AGENTS.md) | Shared engineering-agent instructions |
| [CLAUDE.md](CLAUDE.md) | Claude entry point referencing the shared instructions |

Proposed defaults are engineering decisions, not claims of deployed capabilities. Change the owning document and all affected contracts together. Security restrictions take precedence over convenience. API field names follow DATA_MODEL.md.

## 2. Goals

- Provide an immediately understandable visual overview of a GitHub account.
- Make navigation through repositories and code feel spatial, fluid, and memorable.
- Reveal only the information appropriate to the current altitude through semantic zoom.
- Let users inspect the state of the world at meaningful historical points.
- Scale from small student accounts to large accounts through level-of-detail (LOD) streaming.
- Protect private source code and GitHub credentials by default.
- Produce shareable read-only worlds with explicit owner controls.
- Keep the MVP web-first and leave room for a later desktop wrapper for local repositories and offline use.

## 3. Non-goals for MVP

- A full code editor or Git client.
- A replacement for GitHub issues, pull requests, or code review.
- Real-time multi-user editing.
- Exact geographic simulation or realistic nation-building gameplay.
- Parsing every programming language with full compiler accuracy.
- Displaying every historical commit at once.
- Executing repository code.
- Training models on private source code.

## 4. Canonical product vocabulary

These terms are normative across product copy, schemas, APIs, analytics, and code comments. The extended overlays below describe the product direction; section 8 identifies the MVP subset.

| Software concept | World concept | Visual level |
|---|---|---|
| GitHub account | World / globe | Orbit |
| Repository | Country | World surface |
| Top-level folder | State | Country view |
| Nested folder | City or district | State/city view |
| File | Building | District view |
| Class or component | Floor | Building view |
| Function or method | Room | Floor view |
| Commit | Historical event | Timeline |
| Branch | Alternate timeline | Timeline selector |
| Contributor | Citizen / architect | Attribution overlay |
| Pull request / issue | Project / construction zone | Activity overlay |
| Release / tag | Landmark / era marker | World and timeline |

“Region” may be used in explanatory prose for folders at any depth; the canonical data type is `directory`. In the UI, depth one is always a state; deeper folders are cities or districts.

## 5. Target users and jobs

### 5.1 Student builder

Wants to present projects in a way that is more compelling than a repository list, identify growth over time, and explain architecture during a hackathon demo.

### 5.2 Professional developer

Wants to orient inside an unfamiliar account, find active and neglected repositories, inspect ownership, and understand how structure evolved.

### 5.3 Open-source maintainer

Wants to show community activity, releases, contributors, and major structural changes without exposing secrets or private material.

### 5.4 Portfolio visitor

Wants a guided, low-friction experience that communicates scope and craft without requiring Git knowledge.

## 6. Core experience

### 6.1 Entry and connection

1. The user lands on a lightweight demo world or signs in with GitHub.
2. The app requests only the GitHub App permissions required by the enabled features.
3. The user chooses selected repositories in a read-only GitHub App installation and then confirms DevWorld inclusion; private ingestion requires an explicit selection.
4. The app builds a world manifest asynchronously and opens the globe as soon as country-level metadata is ready.
5. Deeper geometry and symbols stream in as needed. Each published world version is immutable; a later complete version replaces the first metadata-only version atomically.

### 6.2 Semantic zoom

| Camera level | Required presentation |
|---|---|
| Orbit | Globe, country silhouettes, repository names, size/activity signals, major landmarks |
| Country | State borders and labels, language biome, recent activity, README summary |
| State | Cities/districts, important buildings, path breadcrumb, ownership/activity overlays |
| City/district | Buildings, file-type architecture, dependency roads, hotspots |
| Building | File metadata, floors for classes/components, imports/exports, code outline |
| Floor | Rooms for functions/methods, complexity and change indicators |
| Room | Function signature, documentation, metrics, history, and safe source preview |

This table describes the full product direction. MVP shows structural metadata, activity, names, history and supported symbol outlines; README summaries, rich ownership/dependency overlays and landmarks are later additions. Signatures, docstrings and source are shown only through an explicitly enabled owner preview, under SECURITY.md.

Labels, interaction targets, geometry density, and overlays change by altitude. Hidden detail must not merely be tiny or transparent; it should not be fetched or rendered until relevant.

Root files sit directly inside their country. Top-level functions sit directly inside their building; do not invent a class to create a floor. A functional component is one floor, not a duplicate floor and room. Unsupported files remain buildings with an outline-unavailable message. Floors and rooms are metaphors for supported syntax, not a promise of compiler-level understanding.

### 6.3 Navigation

- Clicking an entity selects it and starts a smooth, interruptible camera flight.
- Hovering or keyboard focus shows a concise preview without changing level.
- Breadcrumbs preserve the hierarchy and provide instant upward navigation.
- Back and forward actions restore both selection and camera state.
- MVP search locates repositories, paths and symbols in the selected snapshot. Contributor/commit/language facets are later enhancements; timeline markers provide commit navigation initially.
- An “overview” action returns to orbit at any time.
- Deep links use opaque IDs to restore the selected entity, snapshot, branch, and active overlay. A validated camera hint is optional; raw private names and paths never enter URLs.

### 6.4 Persistent timeline

The timeline remains available at every zoom level.

- Default position is the latest indexed state of the default branch.
- Scrubbing previews snapshots at adaptive intervals; releasing resolves the exact eligible commit at or before the target according to DATA.md. Missing earlier coverage remains explicitly unknown.
- The scope follows the current selection but can be pinned to the whole world.
- Significant events—repository creation, releases, large changes, renames, and deletions—appear as era markers.
- Changes between two points can be shown as construction, demolition, growth, decay, and altered roads.
- After MVP, branch selection creates an alternate timeline without implying that branches are separate countries.
- The UI must distinguish exact selected-commit state, coarse preview, incomplete history, and unavailable data. Historical file trees can be exact; historic stars, issues, account membership, and permissions cannot be invented from today's values.
- World time resolves one commit per included repository; there is no account-wide Git commit. MVP follows each repository's default branch as captured in the world version. Explicit alternate branches are a later extension with reserved contracts.
- Folder and file history use the same repository revision clock, then filter to the selected entity. Renames retain identity only when matching is reliable. See DATA.md for deterministic resolution and force-push behavior.

### 6.5 Visual encodings

- Country area primarily reflects repository size using a logarithmic scale.
- Building footprint and height encode clamped source bytes and lines; inspection exposes actual class/component floors and function rooms.
- Illumination reflects recent activity; optional organic biomes may add vegetation later.
- Architectural style or terrain biome reflects primary language, with an accessible legend.
- Roads represent selected dependency relationships, not every import by default.
- Construction zones represent open pull requests or issues when that overlay is enabled.
- Ruins or subdued terrain represent archived or long-inactive repositories without implying poor quality.

Every visual encoding must have a text or numeric explanation in the inspector. Color must never be the only signal.

## 7. Functional requirements

### 7.1 Account ingestion

- Connect a GitHub account through a GitHub App using server-side user authorization and selected repository installations.
- List repositories the user is authorized to view.
- Allow explicit inclusion and exclusion before private data is ingested.
- MVP reads repository metadata, default refs, commits, trees and permitted blobs. Contributor/release/issue/PR overlays and alternate branches are collected only when their later features and permissions are enabled.
- Accept webhook updates for connected installations.
- Ship a bundled synthetic demo without sign-in. Live public-account lookup is a later feature, with separate abuse and rate controls.
- Support local repository import in a later desktop phase.

### 7.2 Analysis

- Build a normalized hierarchy from repository trees.
- Detect languages, generated files, vendored code, binaries, and ignored paths.
- Extract classes, components, functions, imports, exports, and basic complexity for supported languages.
- Fall back to file-level buildings when a parser is unavailable or fails.
- Produce deterministic layout seeds so a world does not rearrange unexpectedly.
- Generate temporal summaries and change events from commits.

### 7.3 Visualization and interaction

- Render the world at an interactive target of 60 FPS on recommended hardware and remain usable at 30 FPS on minimum hardware.
- Stream visible LOD tiles with cancellation and prioritization.
- Provide mouse, touch, keyboard, and reduced-motion navigation modes.
- Provide selection, search, language/activity controls, inspector, breadcrumbs and timeline. Gate later overlays and sharing behind their release milestones.
- Recover gracefully from WebGL context loss and provide a 2D/tree fallback for unsupported devices.

### 7.4 Sharing and export

- After MVP, create revocable, read-only share links for explicitly approved public repositories. Private-repository sharing is out of scope for v1, even with name redaction.
- Never include private repositories in v1 shares.
- Allow the owner to hide names, paths, contributors, and activity in public-repository projections. Shares never include source content. Generate a separate allowlisted dataset; hiding UI labels is insufficient.
- Export a world summary image and a JSON manifest in a later milestone.

## 8. MVP scope

### Must have

- GitHub sign-in and repository selection.
- World-to-building hierarchy: account, repositories, folders, and files.
- Symbol extraction for TypeScript/JavaScript and Python, represented as floors and rooms.
- Smooth camera flights, semantic zoom, breadcrumbs, inspector, and search.
- Default-branch history with a persistent timeline and key event markers.
- Deterministic layouts and LOD streaming.
- Explicit public/private repository inclusion controls, private-by-default world access, deletion and token revocation handling.
- Desktop and mobile-web responsive layouts; mobile uses reduced geometry or the accessible atlas.

### Post-MVP v1.1

- Explicit alternate-branch timelines with captured lineage selection.
- Dependency roads, contributor overlay, releases, issues, and pull request overlays.
- Side-by-side timeline comparison.
- Guided portfolio tour.
- Share links with redaction controls.

### Later

- Native desktop wrapper for local repositories, offline caching, and larger analyses.
- Additional language parsers.
- Organization worlds and team permissions.
- Collaboration, annotations, and embeddable worlds.
- Optional AI-generated architectural summaries with explicit consent.

## 9. Quality requirements

- Initial shell interactive within 2.5 seconds in the controlled profile in TESTING.md.
- Country metadata visible within 5 seconds for a previously indexed standard fixture; first-time indexing is a separate asynchronous operation with progress.
- Camera input response below 100 ms.
- Steady navigation targets p95 frame time at or below 20 ms on the reference desktop. Report main-thread tasks over 50 ms; parsing and tile decoding run off-thread.
- WCAG 2.2 AA for non-canvas controls and equivalent keyboard-accessible navigation for canvas content.
- 99.9% monthly availability target after public launch, excluding planned maintenance.
- Account deletion denies access immediately after acceptance, removes active data within 24 hours, and expires backups within 30 days. These are launch acceptance targets to verify, not a current service promise.

## 10. Success metrics

### Activation

- Percentage of connected users who reach an interactive world.
- Median time from authorization to first country view.
- Percentage who zoom from country to at least one building.

### Engagement

- Timeline interactions per session.
- Search-to-selection success rate.
- Number of meaningful hierarchy levels explored.
- Return visits and shared-world opens.

### Reliability and trust

- Ingestion completion and incremental-update success rates.
- Render crash and WebGL context-loss rates.
- Private-data exposure incidents: target zero.
- Deletion and revocation SLA compliance.

Metrics and diagnostics must not collect source content, exact private paths or function names. Use opaque IDs and aggregate measurements under SECURITY.md.

## 11. Key risks and mitigations

| Risk | Mitigation |
|---|---|
| Large accounts overwhelm browser and backend | Progressive indexing, LOD manifests, tile budgets, sampling, cancellation |
| Visualization becomes beautiful but confusing | Stable vocabulary, breadcrumbs, inspector explanations, accessible tree fallback |
| Layout changes destroy spatial memory | Deterministic seeds, stable IDs, localized relayouts, transition animations |
| GitHub rate limits delay ingestion | Conditional requests, webhooks, caching, backoff, visible progress |
| Private code leaks through logs or sharing | Deny-by-default sharing, field-level redaction, log scrubbing, security tests |
| Parsing is inconsistent across languages | Parser adapters, confidence flags, file-level fallback |
| Historical storage grows without bound | Event compaction, checkpoint snapshots, retention and on-demand materialization |

## 12. Acceptance criteria for MVP

The MVP is releasable when a user can connect an account, select repositories, see a stable globe, navigate from a country to a room where supported, scrub the timeline to prior states, search and deep-link to entities, and delete all imported data. Private repositories must remain invisible to other users. Public sharing remains disabled until its separate release gate passes. The application must pass [SECURITY.md](SECURITY.md) and [TESTING.md](TESTING.md).

| ID | Release-blocking user outcome |
|---|---|
| DW-01 | From demo entry, select a country and descend to a Python method room with correct breadcrumbs |
| DW-02 | Rewind a repository, folder, and file to known fixture commits; deleted/renamed entities resolve correctly |
| DW-03 | Rewind the world and show the per-repository revision vector and any coverage gaps |
| DW-04 | Fly, cancel mid-flight, go back, search, and reload a deep link without losing time or selection |
| DW-05 | Stream only relevant detail, hold memory budgets, and recover from context loss |
| DW-06 | Connect only selected repositories, prevent cross-user access, and handle token revocation |
| DW-07 | Complete the same hierarchy and timeline journey by keyboard and in the DOM atlas |
| DW-08 | Delete the world/account, deny reads and queued publication, and verify purge completion |

## 13. Implementation boundary

The first deliverable is a synthetic one-country vertical slice: globe → state → district → building → floor → room, plus three historical states. Build this before GitHub integration to prove navigation, identity, timeline, and rendering contracts. The full MVP then adds selected account ingestion, multiple countries, Python/TS/JS analysis, and default-branch history. Milestone gates and explicit stretch features are in WORKFLOW.md.

Do not rank contributors by productivity, infer code quality from file size, or describe an activity score as a performance assessment. DevWorld explains structure and change; the visuals are navigational encodings.
