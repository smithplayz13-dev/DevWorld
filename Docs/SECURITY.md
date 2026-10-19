# DevWorld — Security and Privacy

**Specification:** v1.0 · 2026-09-26  
**Security posture:** Read-only GitHub access, explicit inclusion, private derived data, no repository execution  
**Related:** [DATA.md](DATA.md), [DATA_MODEL.md](DATA_MODEL.md), [API_SPEC.md](API_SPEC.md), [TESTING.md](TESTING.md)

## 1. Assets, trust boundaries and scope

Protect GitHub credentials, private source, names/paths/symbols, repository membership, commit messages, contributor identifiers, derived geometry, sessions and share capabilities. A country's size or a building label can disclose private information even without source text.

The browser, public internet, imported repositories, webhook payloads before validation, and parser outputs are untrusted. The API enforces authorization. Workers have only the credentials needed for their stage. Parser subprocesses have none. Storage and queues are not public endpoints.

MVP supports one owner's personal-account world. Organization/team permissions, local-repository import, and public sharing are separate release gates. This document defines engineering requirements, not a claim that controls have already been implemented or audited.

## 2. Threat and control matrix

| Threat | Required control | Verification |
|---|---|---|
| User B guesses user A's world/entity/tile ID | Owner/grant/world/snapshot checks on every route | Cross-user contract tests |
| Session theft or forged mutation | HttpOnly secure cookie, CSRF token, exact Origin checks | Cookie and CSRF integration suite |
| OAuth login substitution | Bound state, PKCE, one-use callback, session rotation | Mismatch/replay tests |
| Malicious repository content | No execution; parser sandbox; safe text rendering | Adversarial fixtures |
| Blob/tree resource exhaustion | Size, count, CPU and memory budgets | Limit and timeout tests |
| Private data in public shares | Separate allowlisted projection; public repos only | Redaction sentinel tests |
| Revoked permissions leave cached access | Central grant state, freshness bound, cache purge | Revocation race tests |
| Webhook tampering/replay | Raw-body HMAC, delivery deduplication, idempotent jobs | Signature/duplicate tests |
| Path/URL traversal or SSRF | Construct provider URLs; normalized IDs; reject external targets | Path and network-boundary tests |
| Worker publishes after deletion | Grant-generation check and tombstone before publication | Deletion-during-indexing test |

## 3. GitHub authentication

Use a GitHub App. Sign-in and repository installation are related but distinct: user authorization establishes identity/eligible resources; installation grants the app selected repository access. Request `Metadata: read` and `Contents: read`. No write/admin/workflow/secrets permission is needed. Add `Issues: read` and `Pull requests: read` only when their later overlays ship and users approve the expanded permission. [GitHub permission guidance](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app).

User authorization uses an exact allowlisted callback, random one-use state bound to the initiating browser session, and S256 PKCE. Keep state/verifier server-side with a ten-minute lifetime. Exchange the code on the backend, consume the transaction once, fetch the user identity, then rotate the DevWorld session. GitHub documents the S256 challenge and verifier parameters for this flow. [User access token flow](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app).

Treat return paths as relative local paths from a short allowlist. Reject external, protocol-relative, encoded traversal, and CR/LF values. An `installation_id` from a callback is not proof of authority: verify it belongs to the signed-in personal account and is accessible to that user before connecting it.

Use user tokens for provider actions on behalf of a user. Background jobs may use restricted installation tokens for already approved repositories, but must still check the world's active user grant and policy. User and installation credentials have different access semantics. [GitHub App token guidance](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app).

Do not accept GitHub passwords or personal access tokens in the hosted UI. Enable expiring user tokens and refresh server-side under a lock to avoid concurrent rotation. Installation credentials are minted narrowly and cached only until their declared expiry; do not assume token lengths or parse them for permissions. Never put credentials in URLs, process arguments, analytics, source maps or frontend environment variables.

## 4. DevWorld sessions and API authorization

Use a cryptographically random 256-bit session token in `__Host-devworld_session` with `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, and no Domain attribute. Store its digest server-side. Initial policy: 12-hour idle expiry, seven-day absolute expiry; rotate on login and privilege changes. Local HTTP development uses a separately named development cookie and cannot be enabled in production.

Unsafe methods require `X-CSRF-Token` from the session bootstrap plus an exact expected Origin. Compare CSRF tokens in constant time. SameSite alone is insufficient. OAuth callbacks and signed webhooks have their own validation paths; do not broadly exempt `/api` from CSRF. Same-origin SSE uses the session cookie; do not place bearer tokens in event-stream URLs.

Authorization order: authenticate → find permitted world → check current repository inclusion/grant → validate snapshot/entity/asset belongs to that world → filter restricted fields. Respond with `404` for inaccessible object IDs to avoid confirming existence, `401` for missing session, and `403` for a known permitted world whose requested action is disallowed.

World ownership alone is insufficient if GitHub access has been revoked. Permission freshness is bounded at five minutes on protected requests. Known revocations deny immediately; stale eligibility triggers revalidation, and an inability to verify fails closed. Webhooks reduce this window but do not guarantee instantaneous discovery of an external permission change. Future organization support must model per-user repository grants explicitly.

## 5. Credentials, encryption and application surfaces

Use TLS for browser, provider, database and object-store connections. Encrypt provider credentials at rest with envelope encryption backed by a managed key service. Keep user refresh tokens separate from access-token cache entries; restrict private-key use to the integration component. Encryption supplements access controls and does not hide data from authorized server processing.

Use a restrictive production Content Security Policy: self-hosted scripts/fonts, explicit API origins, no inline executable repository content, `object-src 'none'`, `base-uri 'self'`, and `frame-ancestors 'none'`. Use nonces/hashes for unavoidable app-owned inline scripts. Allow `blob:` workers only if the actual bundle requires them. Set HSTS after HTTPS deployment is verified, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer` on protected/share surfaces.

Render repository names, commit text, README excerpts, paths, symbols and error strings as text. If Markdown rendering is added, disable raw HTML, sanitize links, block `javascript:`/`data:` navigation, and prevent remote README images from creating tracking or credential leaks. Never inject source as HTML or run it in an iframe. Logs use opaque IDs and fixed error codes.

## 6. Repository and local-data handling

Hosted MVP fetches trees/blobs through GitHub APIs without cloning or checking out the repository. Do not run package managers, dependency install hooks, tests, build scripts, imports, Git hooks, LFS smudge filters, notebooks or macros from imported data.

Exclude likely secret-bearing files (`.env` except deliberate inert examples, private keys, credential dumps) before blob retrieval where path rules identify them. Secret-like content discovered later is redacted from preview and diagnostic data. This is defense in depth, not a guarantee that repositories contain no secrets. Generated, vendored, binary and oversize files retain minimal building metadata with an exclusion reason.

Keep path bytes/case faithfully in source identity; use a separate escaped display form. Reject traversal when translating paths to local storage. Never treat a repository path as a host filesystem path. Treat symlinks and submodules as metadata; do not follow targets. Do not download LFS objects automatically. Apply the numerical ingestion/parser limits in DATA.md.

A parser runs as a non-root isolated subprocess/container with no network, no credentials, a read-only input, limited scratch space, and CPU/memory/time quotas. Terminate the process on timeout. Native parser crashes cannot crash the API. The fetch worker and parser must not share a mount containing keys. Source exists only for bounded analysis and is deleted promptly; no raw-source archives in backups.

### Later desktop/local import

The user selects one repository root using a native chooser. Canonicalize it and reject roots outside the granted scope, filesystem roots, drive roots, escaping symlinks/junctions, and unsafe device paths. Inspect Git metadata without hooks, external filters, submodule recursion or credential prompts. Do not store absolute local paths in cloud objects or telemetry.

Use narrow Tauri capabilities and explicit filesystem scope, plus equivalent validation in Rust/Python code. A command permission without a path scope is not a full filesystem grant. [Tauri filesystem security](https://v2.tauri.app/plugin/file-system/).

Default local mode has no upload. Separate consent is required to sync derived metadata, and still separate consent for any source transfer. Store local credentials in the OS vault, protect app data with OS permissions and encryption where supported, and provide a clear local-cache deletion control. Browser folder upload is not a substitute for this permission design.

## 7. Webhooks and network restrictions

Verify `X-Hub-Signature-256` against the exact raw request body using HMAC-SHA256 and constant-time comparison before parsing. Enforce request size and content-type limits. [GitHub signature verification](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).

Persist `X-GitHub-Delivery` with a unique constraint; repeated valid deliveries are harmless and receive a successful acknowledgment. Record receipt time and process only known event types/installations. GitHub does not provide a universal signed delivery timestamp header: do not invent timestamp verification. Use deduplication plus idempotent, authoritative refetches. A stale push never overwrites a newer captured head merely because it arrived later. [GitHub webhook headers](https://docs.github.com/en/webhooks/webhook-events-and-payloads).

Acknowledge after durable receipt, then enqueue through the outbox. Reject invalid signatures. Suspend reads immediately for known installation removal or authorization revocation before expensive downstream work.

Provider requests are built from trusted GitHub base URLs and validated IDs, not arbitrary user URLs. Constrain redirects and block loopback, private/metadata IP ranges, unsupported schemes and credential-bearing URLs. Apply deadlines, decompressed-size limits and outbound egress rules. Use parameterized SQL and allowlisted sort/filter fields.

## 8. Sharing, exports and caches

Sharing is disabled through MVP. Later v1 shares contain explicitly approved currently public repositories only. Exclude source, signatures, docstrings, commit messages and contributor email addresses. Name/path/activity redaction is performed while building a separate projection with its own ID space; recompute aggregates from included data. No owner manifests, source hashes, hidden repository IDs or private-derived country silhouettes may be referenced.

Share links carry a high-entropy secret in the URL fragment, exchanged once through a POST body for a restricted share session. Store only the token digest. Expire/revoke server-side and recheck repository visibility with the same five-minute freshness limit; stale unknown access fails closed. Keep share secrets out of logs and referrers. The full contract is reserved in API_SPEC.md.

Revocation prevents future authorized reads; it cannot erase screenshots or bytes already delivered to someone's device. Use `no-store` for protected/share content, clear application memory on logout/revocation, and do not cache private worlds in IndexedDB, service workers or persistent browser caches. Public synthetic demo caching is separate.

## 9. Retention, removal and restore

| Data | Default retention / action |
|---|---|
| Raw source/parser input | Ephemeral; delete after stage, stale-temp sweep within one hour |
| Credentials | Until expiry/revocation/disconnect; revoke upstream where available and delete locally |
| Derived world/history artifacts | While included and active; configurable history limits apply |
| Job event details | 7 days, opaque IDs and safe codes only |
| Webhook body | Minimize stored fields; encrypted raw body only if required, maximum 24 hours |
| Webhook delivery deduplication | 30 days; effects remain idempotent beyond this interval |
| Operational logs | 14 days, no source/private identifiers |
| Security audits | 30 days using pseudonymous IDs, no source or user content |
| Backups | Rolling maximum 30 days; encrypted and restore-restricted |

Deleting a world/account immediately marks it inaccessible, revokes share/session access as appropriate, increments its grant generation, and cancels pending work. Purge active database/object/cache data within 24 hours. Retain only a non-content deletion tombstone sufficient to prevent resurrection. Backups expire within 30 days; any restore must replay tombstones before allowing traffic. These are release acceptance requirements to verify operationally.

Disconnect deletes credentials and connected-world data under the same purge policy. Removing one repository applies this to that repository and any artifacts containing it. Never delete or change the source repository on GitHub. Show the user what local DevWorld data will be removed and report job status.

## 10. Detection and response

Alert on cross-tenant authorization anomalies, repeated invalid webhooks, grant-validation failures, unusual tile/download volume, failed purges, stale worker leases and secret-scanner findings. Do not send source-bearing exceptions to error trackers. Use synthetic canary identifiers in test fixtures to verify redaction.

If exposure is suspected: disable affected reads/shares; revoke compromised credentials; preserve minimal access/audit evidence; determine the affected users/artifacts; fix and test the boundary; communicate verified facts through a configured operator process; rotate keys if needed; restore access only after review. Configure a real private reporting channel before launch; this pack does not invent an email address.

Release gates: pass cross-user/historical/asset authorization tests, OAuth replay tests, parser isolation tests, deletion races, secret scans, and the retention/restore exercise. A private-data exposure or missing authorization check blocks release.
