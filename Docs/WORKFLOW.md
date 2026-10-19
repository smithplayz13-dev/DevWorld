# DevWorld — Development and Delivery Workflow

**Specification:** v1.0 · 2026-09-26  
**Goal:** Build a convincing globe/time-machine vertical slice, then connect real data safely  
**Related:** [PRD.md](PRD.md), [TECH_STACK.md](TECH_STACK.md), [TESTING.md](TESTING.md), [AGENTS.md](AGENTS.md)

## 1. Working sequence

Read PRD for scope, DESIGN for the command-center experience, DATA for history meaning, and ARCHITECTURE for boundaries. API_SPEC and DATA_MODEL are implementation contracts. Create small vertical slices that are visible and testable. The first milestone should demonstrate the core interaction without requiring live GitHub access.

This pack contains specifications only. The directories, package scripts and commands below are the intended setup contract to create in M0. They are not evidence that an application already exists.

## 2. Milestones and exit gates

| Milestone | Deliverable | Exit gate |
|---|---|---|
| M0 — Contracts and fixture | Monorepo, locked tools, API types, synthetic world, CI basics | Clean setup and a fixture response pass schema validation |
| M1 — Command center | Giant globe, Stark-inspired shell, picking, camera flights, breadcrumbs, DOM atlas | Full world → room journey using synthetic data and keyboard |
| M2 — Time machine | Persistent Chronoscope, three exact states, per-repo vector, rename/delete handling | Rewind world/repo/folder/file without changing time during navigation |
| M3 — GitHub connection | GitHub App flow, explicit repository inclusion, ingestion/outbox, progress | Only approved repos enter a world; revoke/delete tests pass |
| M4 — Real detail and scale | Python/JS/TS/TSX analysis, deterministic geography, LOD streaming, default-branch history | Standard fixture budgets and history invariants pass |
| M5 — MVP release | Mobile/low mode, accessibility, recovery, security and operational drills | All DW-01 through DW-08 release gates and evidence complete |
| M6 — Post-MVP | Public share projections, branch timelines, compare, overlays, guided tours | Feature-specific privacy/performance tests pass before enabling |
| Later desktop | Local read-only import and offline private analysis | Local scope, no-upload, sidecar sandbox and packaging verified |

These are dependency gates, not promised calendar dates. For a solo student builder, implement one gate at a time and keep the demo runnable. A hackathon subset is M0–M2 with a clearly labeled synthetic account; do not label that subset as the complete authenticated MVP.

## 3. M0 setup contract

Create the structure in TECH_STACK.md, copy these documents to the repository root, and add a root workspace manifest. Set up exact runtime versions and lockfiles. Configure development services through `infra/compose.yaml`, with loopback-only database/cache ports and a private local artifact bucket.

Implement these root JavaScript scripts:

| Script | Required behavior |
|---|---|
| `pnpm dev:web` | Start Vite and proxy `/api/v1` to the local API |
| `pnpm build` | Typecheck and produce the frontend build |
| `pnpm lint` | ESLint plus formatting validation |
| `pnpm typecheck` | Strict TypeScript without emit |
| `pnpm test:unit` | Vitest in non-watch mode |
| `pnpm test:e2e` | Playwright critical journeys against the test provider |
| `pnpm contracts:generate` | Generate TypeScript client from exported OpenAPI |
| `pnpm contracts:check` | Fail if generated contracts/examples drift |
| `pnpm docs:check` | Markdown links, code-fence/example checks and naming consistency |

Backend package module names: `devworld.api.main:app`, `devworld.jobs.celery_app:app`, and `devworld.cli`. Provide CLI commands `seed-demo` and `export-openapi`. These use only synthetic data unless an explicit non-demo connection has been configured.

Once the scaffold and scripts exist, the intended first-run commands are:

```powershell
pnpm install --frozen-lockfile
uv sync --project apps/backend --frozen
docker compose -f infra/compose.yaml up -d
uv run --project apps/backend alembic -c apps/backend/alembic.ini upgrade head
uv run --project apps/backend python -m devworld.cli seed-demo
pnpm dev:web
```

Run API and worker processes in separate terminals or Compose services. The Python commands below apply inside the supported Linux/WSL/container environment on Windows:

```text
uv run --project apps/backend uvicorn devworld.api.main:app --reload --host 127.0.0.1 --port 8000
uv run --project apps/backend celery -A devworld.jobs.celery_app:app worker --loglevel=INFO
```

Do not run both Compose and standalone copies of the same worker/API accidentally. In the initial bootstrap, generate lockfiles first; frozen installation becomes mandatory after that first committed resolution. Commit an inert `.env.example`, never real secrets.

## 4. GitHub App setup

Create distinct development and production app registrations. Configure exact HTTPS callback/webhook endpoints for the deployed environments. A developer webhook tunnel is optional and must point only to the development handler. Store its secret outside version control.

Request Metadata read and Contents read, selected repositories, and the required installation/authorization/repository/push events supported by the app configuration. Read all endpoint permission requirements before enabling later issue/PR overlays. Keep expiring user credentials enabled and test refresh/revocation. No GitHub write operations are required for DevWorld ingestion.

Use a disposable account and repository for staging acceptance. Verify identity and selected installation membership server-side. Complete the explicit DevWorld inclusion screen before indexing private code. Always show indexing/permission state in the UI.

## 5. Feature development loop

1. Define the user-visible behavior and relevant PRD acceptance ID.
2. Read affected contract/security rules and inspect existing implementation before editing.
3. Add or extend a minimal synthetic fixture proving the behavior or bug.
4. Update schema/data model first when the contract changes, then generate the client.
5. Implement backend, worker and UI as the smallest complete vertical slice.
6. Run focused tests; add browser/visual validation for interaction changes.
7. Update affected docs and report the actual result, verification and any remaining gap.

For visual work, compare fixed frames and real interaction clips with DESIGN.md. Preserve the globe as the main interface and Chronoscope visibility at every level. Avoid building a conventional dashboard first and postponing the core globe interaction indefinitely.

For history work, manually inspect a fixture with known OIDs and compare the reconstructed tree against expected membership. For security work, test denial paths and races, not only successful reads. Do not run imported repository code to validate a parser.

## 6. Branches, reviews and documentation

Use short-lived branches such as `feat/chronoscope-resolution` and `fix/cancel-stale-tiles`, with small PRs against the default branch. Preserve unrelated work and avoid destructive Git operations. A feature flag isolates unfinished user-visible work; a flag is not a substitute for server-side authorization.

A PR should explain the user problem, resulting behavior, relevant contracts, test evidence and migration/rollback effect. Include a short interaction recording when the camera/timeline changes. Review source privacy, stale-response handling, geometry disposal and temporal meaning when relevant. Do not claim a feature is complete while only its UI shell exists.

When contracts change, update DATA.md, DATA_MODEL.md and API_SPEC.md together. When scope or design changes, update PRD.md and DESIGN.md. AGENTS.md is the shared agent policy; CLAUDE.md points to it so two independent instruction sets do not drift.

## 7. Continuous integration

The proposed check commands, after M0, are:

```text
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm contracts:check
pnpm docs:check
uv run --project apps/backend ruff check apps/backend
uv run --project apps/backend mypy apps/backend/src
uv run --project apps/backend pytest apps/backend/tests
pnpm test:e2e
pnpm build
```

CI uses frozen dependencies and disposable services. Export OpenAPI from the test app without live credentials. Cache dependencies by lockfile; do not cache secrets, private fixtures or source blobs. Use least-privilege GitHub Actions permissions and short-lived cloud identity where supported. Forked PRs must not receive deployment credentials.

Run relevant tests per PR and the wider nightly/release suites from TESTING.md. Documentation changes do not require rebuilding unrelated ingestion code. Fail on schema drift, source-secret findings, permission regressions or missing artifact integrity. Keep test reports as build artifacts with no user data.

## 8. Deployment and rollback

Deploy static web and backend/worker images by immutable build ID. Stage changes first with a disposable provider installation. Verify readiness, DB migrations, job dispatch, object access, SSE buffering and the synthetic globe journey before production promotion.

Use expand/backfill/validate/contract database migrations. Old and new app versions must coexist during rollout. Version tile/parser formats and avoid overwriting published artifacts. Promote API/workers before the client depends on a new optional field. Breaking changes need a versioned contract and migration plan.

Rollback switches application images and active compatible artifact pointers. Do not blindly reverse destructive schema migrations. If a migration cannot safely roll back, stop promotion and fix forward using the tested backup/restore procedure. Feature flags can disable sharing, source preview or expensive overlays independently while preserving basic navigation.

## 9. Operations and runbooks

### Rate-limit or provider outage

Stop aggressive retries, honor provider headers, leave a dated authorized world available, and show a retry time when known. Prioritize the selected country and current state. A permission verification outage fails closed for stale private eligibility even when geometry is cached.

### Stuck indexing

Inspect job stage, lease, attempts and safe provider error code. Recover expired leases and re-enqueue through the outbox. Do not manually mark success or publish partial artifacts as ready. Retry by immutable input and current permission generation.

### Revocation or public-to-private change

Mark the grant/visibility invalid, deny affected reads, cancel publication, close streams and purge caches/projections. Reconcile provider state. Never retain public access just because an old share was once valid.

### Deletion

Commit a tombstone and deny reads first. Cancel workers and reject stale generation writes. Purge database rows, object artifacts, search entries, temp data and active caches. Report active purge status and backup deadline through the limited receipt/job mechanism. Never delete source GitHub repositories.

### Restore

Initial operator goals: metadata RPO ≤24 hours and RTO ≤4 hours, to validate before launch. Restore a staging backup into an isolated environment, replay deletion tombstones, reconcile object references and revoked grants, and run privacy tests before enabling traffic. A successful database restore alone is insufficient. Keep raw source out of backups.

### Performance regression

Reproduce on the recorded fixture/device, inspect frame times and resident resources, then reduce effects or detail within the agreed quality ladder. Avoid fixing a memory leak by raising every memory limit. Profile the selected-view path before adding infrastructure.

## 10. Release definition of done

The release evidence includes passing DW-01–DW-08 journeys, temporal correctness fixtures, private-data denial/race tests, measured desktop/mobile budgets, a keyboard/screen-reader journey, and a verified purge/restore exercise. Publish known limits accurately: supported languages, included repositories, indexed history depth and incomplete observations.

MVP is the connected, read-only, default-branch DevWorld with working globe navigation and history. Post-MVP work can add branch selection, A/B time comparison, public sharing, issue/PR/contributor overlays and desktop import. Keep each gated until its data and privacy contracts are implemented and tested.
