# DevWorld — API Specification

**Contract:** `/api/v1` · schema version 1 · 2026-09-26  
**Status:** Implementable HTTP/SSE specification; proposed endpoints, not a live service  
**Related:** [DATA_MODEL.md](DATA_MODEL.md), [DATA.md](DATA.md), [SECURITY.md](SECURITY.md)

## 1. Global conventions

The web client uses a same-origin FastAPI BFF. JSON keys use `snake_case`; internal IDs are UUID strings; GitHub numeric IDs are decimal strings; timestamps are UTC RFC 3339. Example IDs and metrics below are synthetic. Prefix every route in this document with `/api/v1`.

Success returns a resource directly, or `{ "items": [], "next_cursor": null }` for a page. List `limit` defaults to 50, range 1–100. Cursors are opaque, tamper-resistant and bind sort, filters, snapshot and authorization context. Never use offsets for changing job/history feeds. JSON request bodies reject unknown fields. Defaults: maximum JSON request 64 KiB; webhook body 5 MiB; individual response/asset limits follow DATA.md.

Sessions use the secure HttpOnly cookie in SECURITY.md. Every unsafe browser method requires `X-CSRF-Token` plus a valid Origin, including POST-based read queries used to keep private search terms out of URLs. Callback and webhook exceptions have independent validation. IDs never grant authority by themselves. Protected responses use `Cache-Control: private, no-store`; request logs omit query strings, bodies, credentials and repository names.

POST operations that create jobs/resources require `Idempotency-Key`, a caller-generated UUID retained for 24 hours. Same key + normalized request returns the previous result; different body returns `409 IDEMPOTENCY_CONFLICT`. Keys are scoped to user, route and operation. Retrying a completed deletion is safe. PUT/PATCH require `If-Match` with the returned row-version ETag; mismatch is `412 PRECONDITION_FAILED`.

## 2. Errors and status codes

Return `application/problem+json` with a safe, stable code. Never echo source, raw provider errors, private paths or credentials.

```json
{
  "type": "urn:devworld:problem:history-unavailable",
  "title": "History is outside indexed coverage",
  "status": 422,
  "code": "HISTORY_UNAVAILABLE",
  "detail": "Select a time inside the displayed coverage interval.",
  "request_id": "8bdd51a6-8262-4a9c-93ae-8c4b20466b45",
  "retryable": false
}
```

| HTTP | Meaning / representative codes |
|---|---|
| 200 / 201 | Read or completed command / newly created resource |
| 202 | Durable asynchronous job accepted; result not ready |
| 204 | Completed logout, revocation or idempotent no-content command |
| 400 | Invalid JSON/cursor/header, malformed callback |
| 401 | `SESSION_REQUIRED`, expired session |
| 403 | `ACTION_FORBIDDEN`, `CSRF_FAILED`, `SOURCE_PREVIEW_DISABLED` in a known authorized world |
| 404 | `NOT_FOUND`; also used for cross-user or inaccessible object IDs |
| 409 | `VERSION_STALE`, `IDEMPOTENCY_CONFLICT`, `JOB_NOT_CANCELLABLE` |
| 412 | `PRECONDITION_FAILED` on a stale ETag |
| 413 | `PAYLOAD_TOO_LARGE` |
| 422 | `VALIDATION_ERROR`, invalid scope/selector; explicit unavailable-commit request |
| 429 | `RATE_LIMITED`; include `Retry-After` |
| 503 | `PERMISSION_CHECK_UNAVAILABLE`, temporary provider/service failure; fail closed |

An ordinary time request with missing history can return a ready partial snapshot with `before_coverage` entries. Use 422 when a specifically requested commit is unknown/outside the permitted lineage or the request cannot produce a meaningful result. Do not convert all partial history into a fatal error.

## 3. Authentication and integration endpoints

| Method / route | Input | Success |
|---|---|---|
| GET `/session` | Optional session cookie | 200 `{authenticated, user, csrf_token}`; user/token null when anonymous |
| GET `/auth/github/start` | Allowlisted relative `return_to` | 302 GitHub authorization with state and S256 challenge |
| GET `/auth/github/callback` | Provider `code`, `state` | Validate/consume, rotate cookie, 303 local return path |
| GET `/auth/github/install/start` | Authenticated user | 302 installation flow with server-bound state |
| GET `/auth/github/install/callback` | Installation ID and bound state | Verify account/user access, 303 repository picker |
| POST `/auth/logout` | CSRF; empty object | 204; revoke session and clear cookie |
| GET `/connections` | Session | Page of connection ID, account, status, permission freshness; no credentials |
| GET `/connections/{id}/repositories` | `cursor`, `limit` | Eligible repository page; metadata only |
| DELETE `/connections/{id}` | Session, CSRF, idempotency key | 202 purge job; stop provider access immediately |
| POST `/webhooks/github` | Raw provider body and signature headers | 202 after durable valid receipt; duplicate valid delivery 202 |

Connection repository items contain `github_repository_id`, `name`, `visibility`, `archived`, `default_ref`, `eligible`, and `inclusion_reason`. Discovery does not authorize fetching private source. Follow provider pagination internally; DevWorld cursors do not expose raw provider URLs. GitHub callback denies or errors return to a local screen with a safe code, never a token in the URL.

## 4. Worlds, repository selection and versions

| Method / route | Request | Response |
|---|---|---|
| GET `/worlds` | Page parameters | Owner's worlds, active version and sync status |
| POST `/worlds` | Connection ID, source repository IDs, display name | 202 world + ingestion job |
| GET `/worlds/{id}` | Session | World, included countries, settings, active version; ETag |
| PUT `/worlds/{id}/repositories` | Complete replacement `github_repository_ids`; If-Match | 202 new policy generation + rebuild/purge job |
| PATCH `/worlds/{id}/settings` | `display_name` and/or `source_preview_enabled`; If-Match | 200 updated settings and ETag |
| POST `/worlds/{id}/sync` | `{ "mode": "incremental" }` | 202 job or existing equivalent job |
| GET `/worlds/{id}/versions` | Page parameters | Currently authorized published captures |
| GET `/worlds/{id}/versions/{version_id}` | Session | Version, captured per-country heads, coverage, manifest asset ID |
| DELETE `/worlds/{id}` | CSRF, idempotency key | 202 deletion job; reads denied immediately |

Create request:

```json
{
  "connection_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "github_repository_ids": ["123456789", "987654321"],
  "display_name": "Smith's World"
}
```

Accepted response:

```json
{
  "world_id": "11111111-1111-4111-8111-111111111111",
  "job_id": "99999999-9999-4999-8999-999999999999",
  "status": "indexing",
  "policy_generation": 1
}
```

Only the signed-in personal GitHub account is allowed in MVP. Validate all selected repositories against the user's current installation eligibility. Reject duplicate IDs and unsupported account types. Inclusion is explicit; omitting a previously included repository from PUT removes it, invalidates artifacts containing it, and enqueues purge. The UI must present the resulting selection before submitting. Old generation-specific views return `409 VERSION_STALE` to an otherwise authorized owner, without exposing excluded content.

Settings do not trigger a geometry rebuild unless they affect serialized data. Source-preview authorization is checked live on each preview call. Increment policy generation for inclusion/exclusion, deletion and changes to derived-data policy; ordinary display-name or source-preview toggle changes use row version only.

## 5. Snapshot resolution

POST `/worlds/{world_id}/snapshots/resolve` accepts `world_version_id`, `scope_entity_id`, `selector`, and `precision`. `scope_entity_id` is world root, country or any descendant; default is the world root. Precision is `exact` or `preview`. The supported selector union is:

| Type | Fields | Meaning |
|---|---|---|
| `latest` | `type` only | Captured head of every in-scope repository, regardless of skewed commit dates |
| `time` | `type`, `at` RFC 3339 | Per-lineage as-of resolution from DATA.md |
| `commit` | `type`, `repository_id`, `oid` | Exact known commit; scope must be in that repository |

MVP rejects alternate-ref overrides with `422 FEATURE_NOT_ENABLED`. It follows the captured default lineage. Dates do not mutate refs. A commit selector must resolve to the exact permitted captured lineage; arbitrary OIDs are not a route around authorization.

```json
{
  "world_version_id": "33333333-3333-4333-8333-333333333333",
  "scope_entity_id": "44444444-4444-4444-8444-444444444444",
  "selector": { "type": "time", "at": "2026-06-18T12:00:00Z" },
  "precision": "exact"
}
```

If materialization is needed, return `202` with `{job_id, status:"queued"}` and `Location: /api/v1/jobs/{job_id}`. The completed job identifies its snapshot. If cached/ready, return `200`:

```json
{
  "snapshot_id": "55555555-5555-4555-8555-555555555555",
  "world_id": "11111111-1111-4111-8111-111111111111",
  "world_version_id": "33333333-3333-4333-8333-333333333333",
  "scope_entity_id": "44444444-4444-4444-8444-444444444444",
  "selector": { "type": "time", "at": "2026-06-18T12:00:00Z" },
  "precision": "exact",
  "coverage": "partial",
  "coverage_reasons": ["HISTORY_LIMIT"],
  "repositories": [
    {
      "repository_id": "22222222-2222-4222-8222-222222222222",
      "status": "resolved",
      "object_format": "sha1",
      "resolved_commit_oid": "0123456789abcdef0123456789abcdef01234567",
      "repo_snapshot_id": "66666666-6666-4666-8666-666666666666",
      "coverage": "partial",
      "coverage_reasons": ["HISTORY_LIMIT"]
    }
  ],
  "manifest_asset_id": "77777777-7777-4777-8777-777777777777"
}
```

`exact` and `partial` can coexist: the selected commit tree is exact while older history is limited. Non-resolved entries have null commit/snapshot fields and status `not_yet_created`, `before_coverage`, `empty` or `unavailable`, plus coverage bounds. No synthetic empty state for missing data. A preview reports the actual resolved commit(s); it may use an earlier checkpoint but cannot impersonate the requested exact time.

GET `/snapshots/{id}` returns the same immutable resource. Currently revoked or excluded inputs make it inaccessible even if it once resolved successfully.

## 6. Navigation, search, LOD and source

| Method / route | Input | Output |
|---|---|---|
| GET `/snapshots/{id}/manifest` | Optional `entity_id`, `lod` L0–L3 | Manifest metadata and authorized tile references |
| GET `/snapshots/{id}/entities/{entity_id}` | Selected snapshot | Entity detail or known absent state |
| GET `/snapshots/{id}/entities/{entity_id}/children` | Cursor/limit | Children in stable layout/path order |
| POST `/snapshots/{id}/search` | `{query, scope_entity_id?, include_history?, limit?, cursor?}` | Authorized results; 1–100 limit, query 1–200 chars |
| GET `/assets/{asset_id}` | Session; optional valid byte range if enabled | Validated authorized manifest/buffer/mesh bytes |
| POST `/snapshots/{id}/source-preview` | `{entity_id, start_line, end_line}` | Bounded owner-only source; explicit preview setting required |

Search uses a POST body so private terms/paths stay out of URLs and access logs. `include_history=false` is the default. Historical results indicate `exists_at_snapshot` and optional first-known appearance; they remain within the same currently authorized world.

Entity fields: `entity_id`, `repository_id` (null for world), `kind`, derived `semantic_level`, `name`, `path`, `parent_entity_id`, `directory_depth`, `language`, `metrics`, `analysis_status`, `exclusion_reason`, `bounds`, `child_count`, and `exists_at_snapshot`. Source ranges may be included for owner navigation; source bodies/signatures/docstrings are absent. `kind` follows DATA_MODEL.md exactly. For a known entity absent in this snapshot, return `exists_at_snapshot=false`, a safe last-known name if permitted, and `nearest_existing_ancestor_id`; do not imply current path existed historically.

Manifest core:

```json
{
  "schema_version": 1,
  "snapshot_id": "55555555-5555-4555-8555-555555555555",
  "layout_epoch": 1,
  "pipeline_hash": "9b93c9dc9e9f503d97796b9c2662b6b4325778030b0b0672a4c9590d5480a310",
  "coordinate_frame": { "type": "world", "globe_radius": 1 },
  "lod": "L0",
  "tiles": [
    {
      "tile_id": "88888888-8888-4888-8888-888888888888",
      "header_asset_id": "12121212-1212-4212-8212-121212121212",
      "payload_asset_id": "13131313-1313-4313-8313-131313131313",
      "byte_length": 4000,
      "uncompressed_byte_length": 4000,
      "content_sha256": "4ed2310379943668caf55e9d35c435d3d7cf0e5b701034db875d0e813a0bd19c",
      "bounds": { "center": [0, 0, 0], "radius": 1.1 },
      "geometric_error": 0.08,
      "children": []
    }
  ]
}
```

Checksums above illustrate shape; implementation fixtures must contain actual matching bytes. The instance payload is the 40-byte-stride format in DATA.md, served as `application/octet-stream`; headers/manifests are `application/json`. Assets must be owned by the requested authorized context. Internal checkpoint assets are not browser-downloadable through this route. Unknown schema versions produce `409 UNSUPPORTED_SCHEMA`; the client reloads or selects a supported fallback.

Source-preview limits: 200 lines, 64 KiB, positive 1-based lines, end line inclusive for the HTTP request only. Symbol storage ranges remain exclusive as defined in DATA_MODEL.md. Resolve symbol selections to their owning file. Fetch the immutable blob under current permission, deny excluded sensitive/binary files, and return `{entity_id, file_entity_id, start_line, end_line, language, text, truncated}` with `no-store`. Do not log response text or persist it in caches. This endpoint never exists in the share namespace.

## 7. Timeline and history queries

GET `/worlds/{id}/timeline` accepts required `world_version_id`, optional `scope_entity_id`, `from`, `to`, `bucket=day|week|month`, `cursor`, `limit`. Require `from <= to`, at most 366 buckets per response, and paginate changes separately. Return bucket counts, coverage intervals, clock-adjusted marker flags and safe event summaries. Current-only overlay observations are labeled explicitly.

GET `/snapshots/{id}/entities/{entity_id}/history` returns `{items, next_cursor}` with `operation`, `commit_oid`, `effective_at`, `committed_at`, `confidence`, and before/after version IDs for the currently authorized lineage. It does not expose commit message bodies by default. Navigating a marker calls snapshot resolution with its commit selector.

Post-MVP reserved routes: GET `/worlds/{id}/repositories/{repository_id}/refs` and POST `/worlds/{id}/comparisons`. They return `404` while the capability is disabled and are not promised by MVP clients. Comparison requests bind both snapshot IDs to the same permitted world, compatible pipeline and layout epoch; otherwise require an explicit re-materialization.

## 8. Job lifecycle and SSE

GET `/jobs/{id}` returns job ID/kind/status/stage, completed/total counts, retry time, safe error code and result. Result is null until successful, then `{type:"world_version"|"snapshot"|"deletion"|"share_projection", id}`. DELETE `/jobs/{id}` requests cooperative cancellation; return 202, or 409 if the irreversible deletion stage must finish. POST `/jobs/{id}/retry` retries a failed eligible job with a new idempotency key and current authorization.

GET `/jobs/{id}/events` uses `text/event-stream`, same-origin cookies, no proxy buffering, and `Last-Event-ID` resume. Events carry monotonic per-job integer IDs:

```text
id: 12
event: job.progress
data: {"job_id":"99999999-9999-4999-8999-999999999999","stage":"parse","completed":42,"total":100}

id: 13
event: version.available
data: {"world_version_id":"33333333-3333-4333-8333-333333333333","status":"ready"}
```

Other types: `job.queued`, `job.retrying`, `job.failed`, `job.cancelled`, `job.completed`, `permission.revoked`, `stream.reset`. Heartbeat comment every 15 s. Check session/grant state at open and at least each heartbeat; close after revocation. For an expired event cursor, send `stream.reset` and require a fresh job GET. Clients deduplicate by ID, reconnect with bounded backoff, and stop after terminal state. Events never carry source, private paths or credentials. A deletion job may expose only minimal purge status to its requesting owner after world reads are blocked.

## 9. Deletion and share contracts

DELETE `/me` requires session, CSRF, idempotency key and `{confirm:true}` after the UI explains removal. Mark the account deleting, cancel publication, invalidate ordinary sessions and return 202 with `deletion_id`, a random `receipt_token`, `active_purge_due_at` and `backup_expiry_due_at`. The one-purpose receipt is shown once and never logged.

GET `/deletions/{deletion_id}` accepts `Authorization: Bearer <receipt_token>` and returns only `accepted|purging|active_purged|complete`, timestamps and a safe error state. Store a token digest; rate-limit the route. The receipt expires after the backup deadline plus seven days. It cannot access any user/world resource. World/connection deletions can use authenticated job status instead.

Post-MVP share routes, disabled by default:

| Method / route | Contract |
|---|---|
| POST `/worlds/{id}/shares` | Owner submits public repository IDs, field allowlist, aliases, expiry; 202 projection job |
| GET `/worlds/{id}/shares` | Owner list, no raw token redisplay |
| POST `/worlds/{id}/shares/{share_id}/token` | Issue/rotate secret once after projection is ready; 201 token + URL fragment |
| DELETE `/worlds/{id}/shares/{share_id}` | Revoke link and sessions; 204 |
| POST `/share-session` | Exchange fragment secret in body; exact Origin + rate limit; restricted cookie |
| GET `/shared/snapshot` | Restricted projection only, no owner IDs/source |
| GET `/shared/assets/{asset_id}` | Projection ownership, expiry, revocation and public-visibility checks |

Share secret rotation invalidates the prior secret/sessions. Initial maximum link life 30 days; share session ≤1 hour and never beyond link expiry. Public-to-private visibility transitions invalidate projections on discovery; visibility freshness is at most five minutes and stale unknown state fails closed. There is no public private-repository-sharing feature in v1.

## 10. Limits, compatibility and provider mapping

Operational routes: GET `/health/live` returns 200 for a running process; GET `/health/ready` returns 200 only when required database/storage configuration is available, otherwise 503. Return a minimal status without hostnames, credentials or dependency errors. Edge readiness and internal detailed diagnostics are separate; never expose a public debug route.

Initial application limits: metadata reads 120/min/session, snapshot resolution 30/min/world, search 60/min/session, sync 3/hour/world, source preview 30/min/session, and tile reads 600/min/session with the in-flight limits from DATA.md. Return 429 with Retry-After; use server-side per-world job coalescing so scrubbing cannot spawn unlimited work. These are tunable DevWorld defaults, not GitHub quotas.

GitHub adapter uses documented identity/installation discovery, repository/ref/commit metadata, Git tree and blob endpoints, plus signed webhooks. Construct provider URLs internally from validated IDs and allowlisted base hosts. Authenticate background and user-requested operations with the appropriate token type. Pin/test an explicit GitHub API version; do not silently copy a stale version string from this document.

Generate OpenAPI from Pydantic models and a TypeScript client from that schema in milestone M0. Validate every example above against the implementation schema, test problem responses and authorization per route, and fail CI on an unreviewed breaking change. Additive optional fields are allowed within v1; changes to required fields, ID meaning, selector behavior or binary layout require a new version and migration plan.
