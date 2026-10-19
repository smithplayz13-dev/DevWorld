# DevWorld — Data Collection and Temporal Semantics

**Specification:** v1.0 · 2026-09-26  
**Owner of:** ingestion rules, history meaning, coverage, deterministic transforms and LOD payloads  
**Related:** [DATA_MODEL.md](DATA_MODEL.md), [API_SPEC.md](API_SPEC.md), [SECURITY.md](SECURITY.md)

## 1. Canonical hierarchy and data classes

| Source object | `entity.kind` | UI representation |
|---|---|---|
| GitHub account | `world` | World / globe |
| Repository | `repository` | Country |
| Top-level folder | `directory`, `directory_depth=1` | State |
| Deeper folder | `directory`, depth ≥2 | City / district |
| File | `file` | Building |
| Class | `class` | Floor |
| Recognized UI component | `component` | Floor |
| Function or method | `function` | Room |

`semantic_level` is a presentation value, not an entity type. Root files have the country as parent. Top-level function rooms have the file building as parent. Functional components are classified once as components; nested functions may become rooms. Anonymous or ambiguous constructs retain file-level metrics until an adapter can name them reliably.

Classify data as provider metadata, source-derived metadata, raw source, geometry/artifacts, identity/credentials, or diagnostics. Private names, paths, metrics, structure and hashes are sensitive derived data. Public origin does not automatically authorize DevWorld publication.

## 2. Source inventory and truthfulness

| Data | MVP collection | Historical meaning |
|---|---|---|
| Account ID/login/avatar | Identity and confirmed world owner | Current observation; login can change |
| Repository ID/name/visibility/archive/default branch | Included repositories only | Dated observations, not reconstructed from commits |
| Git trees and blobs | Captured default-branch heads; historical trees on demand | Exact at a known commit, subject to exclusions |
| Commit OID, parents, author/committer times | Bounded first-parent ancestry | Git data; dates are user-controlled and may be skewed |
| Symbols, lines, static imports | Permitted Python/JS/TS/TSX text blobs | Derived at blob OID + parser/query version |
| Contributor identity | Minimal attribution when enabled | Commit attribution is not proof of current membership |
| Stars, forks, issues, PRs, releases | Post-MVP overlays | Current/observed state unless dated records exist |
| Branches beyond captured default | Post-MVP | Explicit separate lineage |
| Local repositories | Desktop extension only | Local data stays local by default |

Never imply that today's star count or repository name was true years ago. Account history is the history of currently included accessible repositories, not a complete record of everything the account ever owned. Previously deleted or inaccessible repositories cannot be reconstructed unless DevWorld already recorded authorized data and policy still permits it. Old access permission never overrides current denial.

## 3. Ingestion algorithm

1. Discover eligible repositories through the signed-in user's grant and selected installation. Confirm inclusion before fetching private blobs.
2. Capture repository metadata, default ref and head OID into an immutable world-version input. Recheck policy generation before every publication.
3. Fetch the tree by OID. Follow pagination and truncation markers. A recursive GitHub tree can be truncated; fetch non-recursive subtrees when necessary rather than treating the result as complete. [GitHub tree endpoint](https://docs.github.com/en/rest/git/trees).
4. Normalize paths, classify exclusions, count structures and publish a country-level preview version.
5. Fetch permitted source blobs once per repository/blob OID. Parse in isolation, store derived entity versions, delete raw inputs.
6. Traverse first-parent commits from the captured head within the history budget. Read parent OIDs explicitly; a date-sorted commit list is not a safe substitute for ancestry.
7. Compare trees against the first parent to derive add/delete/modify events. Reuse unchanged subtrees and blob analysis. Detect moves conservatively.
8. Build checkpoints, stable layout, spatial bounds and LOD artifacts. Validate manifest integrity, then publish a ready world version.

Use conditional provider requests and a per-installation serialized fetch queue initially. Honor `Retry-After` and rate-limit reset headers; distinguish authorization failures from rate limits. Do not hardcode one quota for every token type. [GitHub REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api), [rate-limit headers](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).

Push webhooks request reconciliation; they are not a complete canonical tree or a guarantee of arrival order. Fetch the current authorized ref, compare captured OIDs, then build a new version. Reconciliation also repairs missed events.

## 4. Initial engineering budgets

These are configurable DevWorld limits, not GitHub service limits. Show exceeded limits and partial coverage rather than silently truncating.

| Resource | Initial default |
|---|---|
| Included repositories/world | 100; larger accounts get explicit selection |
| Tree entries/repository | 100,000; stop with partial coverage if budget exhausted |
| Analyzed source bytes/repository/version | 100 MiB incremental input |
| Text blob eligible for parsing | ≤2 MiB decoded; larger file is metadata-only |
| Source preview | ≤200 lines and ≤64 KiB per response |
| Folder depth | 64; deeper paths aggregate as metadata-only descendants |
| History/repository | Most recent 2,000 first-parent commits; fetch metadata before deep parsing |
| Fast initial history | First 200 recent commits, expand within the 2,000 cap in background |
| Checkpoint interval | Every 100 indexed mainline commits plus current/requested states |
| Parser limit | 5 s wall time and 256 MiB per blob; kill subprocess on overrun |
| Job stage deadline | 15 min; checkpoint/reschedule larger work |
| Concurrent provider requests | One per installation initially, with global admission limits |
| Tile requests/client | Four desktop, two mobile |
| Uncompressed tile payload | ≤1 MiB target, split oversized parcels |

Use a decompressed-byte counter, not only Content-Length. Limits apply before allocation and after decoding. A skipped blob remains a building with `analysis_status=excluded` and `exclusion_reason=oversize|binary|generated|vendor|sensitive|depth_limit`. Permission-denied objects are not shown to unauthorized viewers as labeled exclusions.

## 5. Normalization and analysis

Git paths are case-sensitive identities even on Windows. Preserve Unicode and exact provider path identity; keep a display-safe normalized form separately. If raw path bytes cannot be represented faithfully, retain a byte-encoding identity and mark the display as escaped. Do not merge two files because their names normalize or case-fold to the same string. Search normalization is independent of identity.

Store Git object IDs as algorithm plus hex value; do not assume every future provider object ID has exactly 40 characters. IDs from GitHub are decimal strings in APIs to avoid browser integer precision loss. Internal identifiers are UUIDs. All timestamps are UTC RFC 3339 with original Git offsets retained where useful.

Binary files, generated bundles, vendored directories, lockfiles, LFS pointers, symlinks and submodules have separate classifications. A lockfile can be a building without symbol parsing. Never follow a symlink or fetch a submodule/LFS target automatically. `.gitignore` is not a security rule and does not erase already tracked files; exclusions are explicit DevWorld policy.

Adapters return entity candidates, parent ranges, static import edges, metrics, diagnostics, language and parser/query versions. Coordinates use 1-based lines and 0-based UTF-8 byte columns; convert to editor-specific coordinates at display time. End ranges are exclusive. Mark syntax-error regions and uncertainty; do not claim a tolerant syntax parse proves valid code.

Metrics: total bytes, source lines, symbol count and recent changed-commit count. Complexity is a documented syntax estimate per parser, not comparable across languages without calibration. Imports resolve only when static evidence supports a target. Dynamic imports and external packages remain unresolved/external edges. A road is a static dependency relation, not a complete runtime call graph.

## 6. Identity across change

Files/directories get persistent internal entity IDs. Paths and parents live in immutable entity versions. For a first-parent transition: keep IDs for unchanged paths of the same kind; match unambiguous deleted/added paths with identical blob OIDs as renames; use a later similarity detector only with confidence and evidence. Ambiguous matches remain delete/add. Copies always get new IDs.

Directory move identity requires consistent descendant matches, not a name guess. Symbols match by kind, enclosing identity, qualified name and normalized structural evidence. Overloads use disambiguators. Major refactors may produce new symbol IDs; expose this limitation rather than stitching unrelated history. A class becoming a function gets a new entity kind/identity with an optional relationship event.

Reusing the same bytes in two repositories does not imply shared identity or shared authorization. Deduplicate derived analysis within a world/repository boundary first. Cross-tenant content deduplication is deferred to avoid hash-existence and deletion isolation problems.

## 7. Exact time-machine semantics

### Three times and one lineage

Store `authored_at` and `committed_at` from Git and `observed_at` from DevWorld. For each captured first-parent lineage, order commits by ancestry from oldest indexed to newest and assign increasing `ordinal`. Compute `effective_at[i] = max(committed_at[i], effective_at[i-1])`. This prevents clock-skewed children appearing before their parent in the date scrubber. When dates tie, the larger ordinal wins; individual commit stepping remains possible. Show original dates in the inspector and a clock-adjusted flag when applicable.

Every world version pins a specific `lineage_id` per repository. Force pushes create a new lineage. The old lineage can remain viewable only while retention and current authorization permit; do not silently rewrite an old snapshot or assume a removed commit remains fetchable forever.

### Resolving an as-of view

For each included repository, choose the highest ordinal with `effective_at <= requested_at` in the version's captured lineage. For an explicit commit request, verify the commit belongs to the allowed captured lineage and use that exact commit regardless of the scrubber date rule. The `latest` selector (the Now button) uses each captured head directly, even if its Git date is skewed into the future; this is distinct from a wall-clock timestamp query.

If no eligible commit exists:

- `not_yet_created` only if the complete ancestry to the root is known and the target precedes the first effective commit.
- `before_coverage` if older ancestry is not indexed; no empty-tree inference.
- `empty` if the repository is known to have no commits.
- `unavailable` if the required authorized tree is missing or no longer retrievable.

The result is a per-repository vector with commit OIDs, repository snapshot IDs, status and known coverage bounds. In world mode each repository uses its own captured default ref; there is no meaningful universal `main` branch for the whole account. Folder/file/symbol scopes filter their containing repository state; they do not choose independent commits.

`precision=exact` means each resolved tree equals its selected commit; it does not promise complete account history. `precision=preview` means the client receives a nearby precomputed state while dragging. `coverage=partial` records any unresolved history, incomplete tree or excluded analysis. `coverage=complete` means complete within the declared included repositories and requested analysis policy, never all GitHub data.

Preserve the selected entity ID across time. If absent, show its known nearest ancestor and an “Absent at this time” inspector. If identity is uncertain, show the discontinuity. World time cannot make revoked content visible.

### Checkpoints and changes

Represent commit changes against the first parent as `added`, `removed`, `modified`, `renamed`, or `moved`. Store before/after entity-version references, commit, evidence and confidence. Checkpoints contain full membership maps; intermediate states apply deltas in ordinal order. Verify the final tree/object fingerprint before marking a repository snapshot ready. A checkpoint at commit C includes C's changes exactly once.

Materialize and cache frequently requested exact states. Keep changes idempotent. When reducing old history, retain the checkpoint needed to interpret retained events. A missing dependency must invalidate the dependent materialization, not produce a plausible partial replay labeled exact.

## 8. Geography and LOD formats

World seed and layout epoch are stable. Country slots preserve spatial memory; directory parcels follow actual parents. Country weight is clamped logarithmic source bytes, buildings use clamped bytes/lines, and activity uses recent changed-commit counts with a displayed interval. Counts exclude sensitive content according to policy and include an exclusion summary where permitted. Never label these values quality or productivity.

| LOD | Payload | Fetch trigger |
|---|---|---|
| `L0` | Country surfaces, anchors, safe labels, bounds | World entry |
| `L1` | State surfaces and child district summaries | Country selection |
| `L2` | District surfaces and file-building instances | State/district approach |
| `L3` | Class/component floors and function rooms | Building inspection |

A manifest includes `schema_version`, world/version/snapshot IDs, pipeline hash, layout epoch, coordinate frame, tile IDs, byte lengths, SHA-256 checksums, bounds, geometric error, dependencies and child tile references. Bounds use world units; globe radius is 1. Country-local frames specify origin and orthonormal basis. Geometry carries opaque pick IDs mapped to authorized entity metadata, never source text.

Initial tile envelope: a UTF-8 JSON header and separate binary instance payload. Header fields include `format_version=1`, `endianness=little`, `instance_count`, and `stride_bytes=40`. Each instance is ten little-endian 32-bit slots: position xyz (float32), scale xyz (float32), material index (uint32), pick index (uint32), flags (uint32), reserved zero (uint32). Orientation comes from the tile's local frame. Arbitrary mesh surfaces use a separate versioned mesh asset; do not force every country outline into the instance format.

Validate lengths before typed-array allocation, bound material/pick indices, reject NaN/infinite transforms, and verify decoded checksums. Compression is transport-level; checksum applies to uncompressed payload. A tile cache key includes world, snapshot, tile, pipeline, layout epoch and current authorization generation. A public projection has an entirely separate cache namespace.

## 9. Freshness, privacy and provenance

Record provider OIDs, collection time, exclusion policy hash, parser/query version, layout version and schema version for every artifact. Display indexing date independently of selected historical time. A provider failure should retain the last authorized valid version with a stale indicator.

Private raw source is ephemeral. Browser persistence is limited to non-sensitive preferences and the synthetic demo. Redaction occurs before serialization and artifact generation. SECURITY.md owns retention periods, deletion deadlines and permission freshness. DATA_MODEL.md owns database constraints; API_SPEC.md owns wire fields. Update all three when the temporal contract changes.
