# DevWorld — Testing and Quality Gates

**Specification:** v1.0 · 2026-09-26  
**Status:** Test plan for implementation; no application tests have been run by producing this documentation  
**Related:** [PRD.md](PRD.md), [DESIGN.md](DESIGN.md), [DATA.md](DATA.md), [SECURITY.md](SECURITY.md)

## 1. Testing strategy

Test the features that can make DevWorld misleading, unsafe or unusable: entity identity, historical reconstruction, permissions, resource limits, and interactive navigation. Use deterministic synthetic repositories and a replaceable GitHub adapter. Unit tests validate rules; integration tests validate transactions and boundaries; browser tests validate actual user journeys. Visual screenshots alone cannot prove history or authorization correctness.

Normal CI requires no live GitHub account or private source. A dedicated manually triggered staging suite may use a disposable test account/app installation, with explicit repository allowlists and cleanup limited to that environment. Never use the user's real repositories as default test data.

## 2. Reproducible fixtures

| Fixture | Contents | Expected behavior |
|---|---|---|
| `tiny-world` | 3 countries, root files, nested folders, Python class/method, TSX component | Full world → room journey and correct skipped hierarchy levels |
| `temporal-world` | 2 repos with different commit dates, 12 commits each | World time resolves different OIDs per repo |
| `rename-copy` | Exact rename, directory move, file copy, ambiguous refactor | Preserve confirmed identity; copy/new ambiguity gets new IDs |
| `clock-skew` | Equal dates, child dated before parent, future-dated head | Prefix-max clock and ordinal tie break; Now uses head |
| `merge-force-push` | Two-parent merge and rewritten mainline | First-parent snapshots; new lineage after force push |
| `coverage-gaps` | Truncated tree, shallow history, missing blob, empty repo | Explicit partial states, no fabricated empty history |
| `hostile-source` | HTML names, secret sentinel, huge blob, pathological syntax, symlink/submodule | Safe display, exclusion and sandbox termination |
| `path-edge-cases` | Case-only names, Unicode normalization pairs, long/deep paths | Distinct identities and safe escaped display |
| `tenant-a-b` | Two users with similarly named worlds, repos and assets | Every cross-user lookup denied |
| `standard-world` | 20 repos, 10,000 files total, 50,000 symbols, bounded 2,000-commit histories | Routine browser performance and streaming |
| `stress-world` | 100 repos, 100,000 files total, 500,000 symbols; deep sparse tree | Selected-view LOD stays within memory; honest indexing limits |

Fixtures are generated from fixed seeds with documented expected entity IDs, commits, membership and checksums. Keep stored fixture sizes small using procedural expansion; do not commit a giant binary test world. All source/people/project names are synthetic. A private sentinel string identifies accidental leaks in responses, logs, screenshots and public projections.

## 3. Unit and property-based tests

### Domain and history

- Same input + pipeline version + seed produces the same normalized hierarchy/layout.
- Root files parent to countries; top-level functions parent to buildings; components are not duplicated as rooms.
- Applying first-parent deltas to a checkpoint yields exactly the selected commit's expected tree.
- A checkpoint includes its own commit once; replay starts at the next commit.
- Equal timestamps select the higher ordinal; clock-skew adjustment is monotonic.
- Date before partial coverage returns `before_coverage`; only known full ancestry permits `not_yet_created`.
- Exact selected state and partial historic coverage can coexist.
- A folder/file uses its repository's resolved revision and retains time while zooming.
- Force-pushed lineages do not mutate previously published versions.
- Ambiguous rename/copy evidence does not merge unrelated IDs.

Use Hypothesis to generate acyclic hierarchies and edit sequences. Assert no cycles, dangling parents, duplicate membership, negative size, lost entities or nondeterministic replays. Compare against a simple reference resolver rather than a second copy of production logic.

### Geometry and streaming

- Country anchors persist within a layout epoch when other countries change.
- Spherical placement handles poles, longitude seam, tiny islands and zero-byte repositories.
- Camera paths stay outside the globe and end inside the view-safe framing bounds.
- Enter/exit LOD thresholds have hysteresis and do not oscillate on tiny camera movement.
- Instance decoding validates stride, lengths, finite values, checksums and index bounds before allocation.
- Eviction disposes owned resources once, preserves shared resources, and cancels abandoned requests.
- Stale timeline or tile responses cannot replace a newer selected snapshot.

### Parsers

Test Python decorators/async/nested functions, JS classes/arrow functions, TS interfaces/generics, TSX components and malformed syntax. Assert syntax-level extraction and confidence, not compiler-grade resolution. Verify ranges in UTF-8 bytes with non-ASCII characters. A timeout/crash becomes file-level `failed`; unsupported/binary/sensitive/oversize inputs keep building metadata with no floor/room promise.

## 4. Integration and contract tests

Run against real disposable PostgreSQL, Redis and S3-compatible services in CI. Use mocked provider HTTP responses for pagination, truncation, rate limits, 401/403/404, expiry, refresh races and malformed responses.

| Boundary | Required assertions |
|---|---|
| Database constraints | Cross-world FKs, duplicate providers, membership and invalid ranges fail |
| Publication | All assets validated before active pointer changes; interrupted upload preserves old version |
| Outbox/worker | Duplicate messages have one effect; lost broker state recovers from accepted DB jobs |
| Permission generation | Exclusion/revocation/deletion during a job blocks stale publication |
| Snapshot API | 200 cached vs 202 queued semantics, exact/preview/partial states, selector validation |
| Source preview | Correct immutable blob; disabled by default; 200-line/64-KiB limits; no logging |
| Assets | Historical tile and checkpoint access cannot bypass ownership; object bucket not public |
| SSE | Monotonic IDs, resume, duplicate suppression, expired cursor reset, revocation closes stream |
| Idempotency | Same request replays; same key/different body conflicts; user scopes are isolated |
| Deletion | Immediate denial, purge targets complete, receipt sees only minimal status |

Generate OpenAPI from backend models and validate request/response examples from API_SPEC.md. Regenerate TypeScript types in CI and fail if committed output differs. Check backward compatibility before changing required fields or enums. Source columns and wire fields must not drift between DATA_MODEL.md and API_SPEC.md.

## 5. Security test suite

Cover OAuth state mismatch, expired/replayed callbacks, PKCE failure, open redirects, installation ID substitution, CSRF missing/wrong token, missing/incorrect Origin, expired/rotated cookies and refresh races. Verify no tokens in bundle, URL, error tracker or logs.

For each world, snapshot, entity, source, search, timeline, job, SSE and asset route, test anonymous access, correct owner, different owner, revoked connection, excluded repository, stale grant and old policy generation. Search/count endpoints must not leak the existence of another user's objects. Historical access receives the same checks as current access.

Webhook tests use official known-value HMAC fixtures plus mutated raw bodies, missing signatures, duplicate delivery IDs, repeated effects and out-of-order pushes. Do not test an invented timestamp header. Parser tests assert blocked outbound network, absent credentials, read-only input, process termination and cleanup after crash.

Later sharing requires private sentinel absence from every projection manifest, binary label table, search result, aggregate, screenshot/export and debug response. Revoke/expire a share, rotate its secret, and turn a source repository private. Verify the freshness bound and fail-closed response. Sharing remains disabled until this suite passes.

## 6. End-to-end journeys

Map browser tests to PRD acceptance IDs:

| ID | Journey |
|---|---|
| DW-01 | Open demo; country → state → district → building → floor → room; inspect correct labels and skipped levels |
| DW-02 | Rewind repo/folder/file; see create/rename/delete at known commits; step back and forward |
| DW-03 | World rewind selects the expected per-repo vector and displays partial coverage honestly |
| DW-04 | Cancel a flight, select a new country, use search, back/forward and reload a snapshot link |
| DW-05 | Navigate dense fixture with delayed/out-of-order tiles; trigger context loss and fallback |
| DW-06 | Authorize mock GitHub flow, include selected repos only, revoke during viewing/indexing |
| DW-07 | Complete hierarchy/time journey using keyboard and screen-reader-compatible DOM atlas |
| DW-08 | Delete during parsing; no late version becomes readable; verify purge and receipt |

Add empty account, no commits, uninstalled app, provider rate limit, offline private view, browser refresh mid-job, and parser-error building flows. A 3D pick must select the same entity ID as its DOM equivalent.

## 7. Visual and accessibility review

Snapshot the six DESIGN.md frames at 1440×900, 1280×720, 768×1024 and 390×844. Freeze seed, camera, time, font loading and animation for screenshot comparisons. GPU output varies across platforms; use per-browser baselines and a small edge tolerance. Never automatically approve new baselines after a failure.

Manual review verifies the Stark-inspired character: dominant cyan globe, amber Chronoscope, sharp readable text, restrained glow, no clutter, accurate cutaways, stable horizon, and meaningful motion. Record orbit descent, interrupted flight and scrubbing clips on real hardware. Low mode must still look intentional.

Run axe-core on controls, keyboard-only navigation, focus order/restoration, 200% text zoom, contrast, reduced motion and color-blind change markers. Test at least one real screen reader. Target WCAG 2.2 AA; automated checks do not establish full conformance. [WCAG 2.2](https://www.w3.org/TR/WCAG22/).

## 8. Performance protocol and budgets

Reference desktop: Intel i5-1135G7/Iris Xe class, 16 GB RAM, 1920×1080, current stable Chromium with hardware acceleration. Low/mobile reference: a recorded real Android device with at least 6 GB RAM and WebGL2; choose and record the exact device before claiming a result. Cross-check Safari/WebKit and Firefox functionality. Record OS, browser, GPU, build, seed, fixture, DPR, viewport and network conditions with every benchmark.

Controlled network: 20 Mbps down, 5 Mbps up, 50 ms RTT. Run five cold-shell trials and ten warm navigation/history trials after warm-up. Synthetic world is already indexed for startup tests; separately measure first-ingestion throughput without promising a fixed duration independent of GitHub limits.

| Measure | Release target |
|---|---|
| Shell usable, controlled cold load | p75 ≤2.5 s |
| Indexed country overview visible | p75 ≤5 s |
| Pointer/keyboard response to visible feedback | p95 <100 ms |
| Desktop steady navigation | Average target 60 FPS; p95 frame time ≤20 ms |
| Low/mobile navigation | Average target ≥30 FPS; p95 frame time ≤40 ms |
| API metadata reads, warm backend | p95 ≤300 ms excluding provider fetch |
| Cached exact snapshot resolution | p95 ≤500 ms backend time |
| Missing historical materialization | 202 within 500 ms; progress rather than blocked request |
| Scene decoded allocations | ≤256 MiB desktop, ≤96 MiB low/mobile estimated CPU+GPU |
| Triangles / draw calls | ≤1.5M/200 desktop; ≤300K/100 low/mobile |
| Repeated navigation memory | After 100 open/close cycles and eviction, live allocations within 10% of warmed baseline |

Track main-thread tasks over 50 ms, tile cache hits, cancelled requests, decode time, texture counts and total tab-memory trend. Parsing/decoding must not run on the main UI thread. Browser memory estimators are approximate; report methodology rather than asserting exact VRAM readings.

## 9. CI and release gates

Per PR: lint/format/type checks, affected unit/property tests, schema/contract checks, relevant DB integration cases, secret/dependency scans, and critical browser journeys. Changes to history/permissions run their full suites. Rendering changes add deterministic visual comparisons and a short manual device check. Documentation-only changes need link/example checks, not unrelated application tests.

Nightly: full generated-history properties, worker/storage failure injection, stress fixture, browser matrix and memory loops. Before release: staging GitHub flow, real hardware benchmarks, screen-reader journey, deletion/backup-restore drill and security review of exposed routes. Block release for permission leaks, incorrect exact history, broken primary navigation, unbounded memory growth or unsupported data presented as exact.

Use the scripts established in WORKFLOW.md after scaffolding. Report commands actually run, results and untested boundaries. A passing synthetic suite is not proof of live GitHub uptime or every device's performance. Keep a release evidence record with build ID, test reports, measured metrics and any explicit exceptions.
