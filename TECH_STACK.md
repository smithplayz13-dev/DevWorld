# DevWorld — Technology Stack

**Specification:** v1.0 · 2026-09-26  
**Status:** Selected implementation baseline; no application code is included in this documentation pack  
**Related:** [ARCHITECTURE.md](ARCHITECTURE.md), [WORKFLOW.md](WORKFLOW.md), [TESTING.md](TESTING.md)

## 1. Stack decision

Use TypeScript for the browser and Python for the backend, ingestion, parsing and layout. This keeps the GPU-facing code native to the browser while making most product logic approachable in Python. Begin with one repository and a modular monolith, with API and worker processes deployed separately.

| Layer | Choice | Reason |
|---|---|---|
| Web application | React, TypeScript, Vite | Fast local development and explicit client rendering |
| 3D rendering | Three.js through React Three Fiber; selected Drei utilities | Scene composition plus direct access to renderer primitives |
| Rendering baseline | WebGL2; WebGPU is an experiment later | Stable fallback and testable browser capability detection |
| 3D animation | One elapsed-time camera/scene controller | Interruptible flight, predictable resource ownership |
| DOM motion | Motion (`motion/react`) for panels/palette/sheets/layout; Anime.js v4 for accents/sequences | One owner per animated property (ADR-009); reduced-motion disables both |
| UI controls | Radix primitives, custom DevWorld CSS tokens | Accessible behavior with the specific holographic visual language |
| Server state | TanStack Query | Cancellation, cache lifetimes and snapshot-keyed requests |
| Local UI state | Zustand | Selection, camera intent, overlays and timeline controls |
| Routing | React Router | Opaque-ID deep links and browser history |
| API/BFF | Python + FastAPI + Pydantic | Typed validation and generated OpenAPI |
| Data access | SQLAlchemy + Alembic + psycopg | Explicit schema, transactions and migrations |
| Primary store | PostgreSQL | Relations, JSONB, full-text/trigram search, constraints |
| Work delivery | Celery + Redis; PostgreSQL jobs/outbox authoritative | Independent heavy work with crash recovery |
| Object artifacts | Private S3-compatible bucket | Immutable manifests, instance buffers and checkpoints |
| Provider HTTP | httpx behind a GitHub adapter | Timeouts, backoff, pagination and fixture substitution |
| Parsing | Tree-sitter bindings + pinned Python/JS/TS grammars and queries | Bounded syntax extraction, no repository execution |
| Tests | pytest/Hypothesis; Vitest; Playwright; axe-core | Backend invariants, client behavior, browser/accessibility testing |
| Quality | Ruff, mypy, ESLint, TypeScript strict, formatter | Consistent contracts and predictable maintenance |
| Observability | OpenTelemetry + structured JSON logs | Trace API/job stages without logging source |
| Packaging | pnpm for JS; uv for Python; Docker Compose for services | Reproducible development and locked dependency graphs |
| CI/CD | GitHub Actions; container deployment | Familiar checks, signed artifacts and controlled releases |
| Optional desktop | Tauri, after web MVP | Local repository access with narrow capabilities |

FastAPI's own guidance distinguishes small in-process background work from heavy jobs that suit a queue such as Celery. DevWorld parsing and indexing use workers, not request-process background tasks. [FastAPI background tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/).

## 2. Version and compatibility policy

Start the compatibility trial with Python 3.12, Node.js 22, PostgreSQL 16+, Redis 7+, React 19 and React Three Fiber 9. These are proposed compatible baselines, not claims about the newest releases. Before the first implementation commit, test the chosen package versions together, choose supported patch releases, and record exact versions in lockfiles and container digests. Match React/R3F major versions and Tree-sitter runtime/grammar ABI versions deliberately.

Commit `pnpm-lock.yaml`, `uv.lock`, runtime-version files and an SBOM. CI installs with frozen lockfiles. Pin parser grammar/query revisions and layout versions because upgrading either changes derived artifacts. Review dependency updates in small batches with smoke tests and geometry/analysis regression fixtures. Never use floating `latest` container tags in production.

On Windows, run API and Celery workers through Linux containers or WSL for the reference development setup. The frontend can run natively. This avoids assuming native Windows worker behavior matches the deployment environment.

## 3. Proposed repository structure

```text
devworld/
  AGENTS.md
  CLAUDE.md
  PRD.md ... DATA_MODEL.md       # These specification files at repository root
  apps/
    web/src/
      app/                      # Routing, shell, session, panels
      scene/                    # Camera, globe, materials, picking
      streaming/                # LOD queue, worker decode, eviction
      timeline/                 # Resolution state machine
      atlas/                    # Accessible DOM explorer
      api/                      # Generated client, fetch wrapper
      styles/                   # DevWorld tokens, fonts and licenses
    backend/
      src/devworld/
        api/                    # FastAPI routes and dependencies
        domain/                 # Worlds, entities, history, policies
        providers/github/       # Provider API adapter
        analysis/               # Parser adapter and query packs
        layout/                 # Geography and tile generation
        jobs/                   # Tasks, leases, dispatcher, reconciliation
        storage/                # Database/object store interfaces
        security/               # Sessions, grants, encryption, redaction
      migrations/
      tests/
  packages/
    contracts/                  # Generated OpenAPI and TS types
    fixtures/                   # Small synthetic histories and tiles
  infra/
    compose.yaml
    containers/
  scripts/                      # Seed, checks, artifact validation
  docs/adr/
```

This is a target structure; scaffold it in milestone M0. Do not claim these directories or commands exist merely because they appear in this specification.

## 4. Rendering implementation details

Use instanced building meshes and reusable materials. Draw country/state borders as simplified line/mesh strips. Share geometry across identical building types. Prefer bounded procedural meshes over heavy downloaded city assets. Semantic levels decide which tile set is needed; a file-count change must not create one React component per unseen file.

Decode instance buffers in a Web Worker. Transfer typed-array ownership once and free GPU resources explicitly when a tile is evicted. Instrument decoded CPU size plus estimated GPU allocations; there is no portable guarantee of an exact GPU-memory reading in browsers.

R3F supports on-demand rendering and instancing patterns. DevWorld uses demand rendering when the scene is still and schedules continuous frames only during user motion or transitions. [R3F performance guidance](https://r3f.docs.pmnd.rs/advanced/scaling-performance).

Use a capability probe at startup. WebGL2 unavailable or repeated context loss selects the DOM atlas. A software-rendered CI browser can validate interaction correctness but cannot certify real-device GPU performance. DESIGN.md and TESTING.md define separate performance profiles.

## 5. Analysis and storage decisions

Tree-sitter yields syntax structure, not complete semantic resolution or runtime call graphs. Python, JavaScript, TypeScript and TSX queries identify classes/components/functions and static imports. Parser errors and ambiguous component detection carry confidence and diagnostic flags. [Tree-sitter introduction](https://tree-sitter.github.io/tree-sitter/).

Use PostgreSQL trigram/full-text search first. Filter authorized world and snapshot membership before ranking results. Do not add a graph database, vector database, distributed search cluster or AI API for MVP. Dependency edges are ordinary indexed tables, rendered only when useful.

Keep raw source ephemeral by default. Store sanitized entity names, paths, ranges, metrics, hashes and layout artifacts as protected derived data. Separate sensitive source previews from geometry. Entity identity is independent of path; historical entity versions own changing path/name/parent attributes.

The private bucket is accessed by backend identity. Protected manifests and tiles go through the API asset gateway. Serve the bundled synthetic demo and application bundles through a CDN. Public sharing later uses separate sanitized projections, not owner artifacts with fields hidden in the client.

## 6. Runtime configuration contract

| Configuration | Consumer | Secret? | Purpose |
|---|---|---|---|
| `DEVWORLD_APP_ORIGIN` | API/edge | No | Exact trusted origin and callback construction |
| `DEVWORLD_DATABASE_URL` | API/workers | Yes | PostgreSQL connection |
| `DEVWORLD_REDIS_URL` | API/workers | Yes | Broker/ephemeral coordination |
| `DEVWORLD_OBJECT_ENDPOINT` | API/workers | No | Trusted object service endpoint |
| `DEVWORLD_OBJECT_BUCKET` | API/workers | No | Private artifact bucket |
| `DEVWORLD_KMS_KEY_ID` | API/workers | Restricted | Envelope encryption key reference |
| `DEVWORLD_GITHUB_APP_ID` | Backend | No | GitHub App identity |
| `DEVWORLD_GITHUB_CLIENT_ID` | Backend | No | User authorization client |
| `DEVWORLD_GITHUB_CLIENT_SECRET` | Backend | Yes | Server-side authorization exchange |
| `DEVWORLD_GITHUB_PRIVATE_KEY_REF` | Worker/integration | Yes | Secret-manager reference, not inline public configuration |
| `DEVWORLD_GITHUB_WEBHOOK_SECRET` | API | Yes | Delivery validation |
| `DEVWORLD_GITHUB_API_VERSION` | Provider adapter | No | Explicit supported provider API version tested in CI |
| `DEVWORLD_DEMO_MODE` | API | No | Enables synthetic provider in local/test only |
| `DEVWORLD_SHARE_ENABLED` | API/web feature flags | No | False through MVP |
| `VITE_DEVWORLD_API_BASE` | Browser build | No | Same-origin `/api/v1` only |

Keep `.env.example` to names and inert examples. Production secrets come from a secret manager. Variables prefixed `VITE_` are public bundle inputs; no credential or private path may use that prefix. Local development credentials must never point fixture tests at a real account by default.

## 7. Deployment and cost boundaries

Start with a static frontend, one API service, one worker service, managed PostgreSQL, Redis, and a private object bucket in one region. CPU-heavy parsers have stricter limits than HTTP workers. Add worker replicas before introducing orchestration complexity. Use an edge proxy to preserve same-origin cookies and streaming SSE.

Do not publish an invented monthly price. Establish a measured budget from: selected source bytes, parsed blobs, indexed commits, worker CPU-seconds, active storage, tile egress, and database load. The initial limits in DATA.md bound costs. Build only necessary deep tiles; reuse content within a world; expire unused materializations; never run every repository's full history on initial sign-in.

No paid AI model is needed for the core product. Optional summaries, voice, or code explanation require a later product/security decision and explicit source-transfer consent. The Stark-inspired presentation is achieved with graphics and interaction design.

## 8. Alternatives and deferrals

Next.js is unnecessary for the initial authenticated canvas application; add static marketing pages separately if needed. A Python-only browser UI would constrain the rendering ecosystem. Cesium/geographic maps solve real-earth problems that DevWorld's fictional geography does not require. WebGPU, a dedicated search engine, organization tenancy, desktop packaging, and public shares each need a measured milestone and acceptance gate.
