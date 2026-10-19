"""DevWorld FastAPI application (``/api/v1``).

Implements the API_SPEC.md contract against the deterministic synthetic
provider. Demo mode serves the bundled synthetic world without credentials;
every live GitHub flow returns an explicit ``FEATURE_NOT_ENABLED`` problem
until M3 configures a GitHub App. No route serves raw private source except
the owner-gated, bounded source-preview endpoint.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import UTC, datetime

from fastapi import FastAPI, Header, Query, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse, StreamingResponse

from .. import history as history_mod
from .. import layout as layout_mod
from .. import security, tiles
from ..models import (
    ConnectionItem,
    EntityDetail,
    JobStatus,
    Manifest,
    ManifestTile,
    RepositoryItem,
    ResolveRequest,
    SearchHit,
    SearchRequest,
    Snapshot,
    SnapshotRepository,
    SourcePreview,
    SourcePreviewRequest,
    VersionDetail,
    VersionSummary,
    WorldDetail,
    WorldSummary,
)
from ..store import Store
from ..synthetic import (
    PIPELINE_HASH,
    ROOT_ENTITY_ID,
    WORLD_ID,
    WORLD_VERSION_ID,
    build_specs,
    eu,
)
from ..showcase import build_showcase_specs

HISTORY = history_mod.WorldHistory(build_specs() + build_showcase_specs())
LAYOUT = layout_mod.build_layout(HISTORY)
STORE = Store()

CONNECTION_ID = str(uuid.uuid5(uuid.NAMESPACE_URL, "devworld:demo-connection"))
DEMO_STATE = {
    "display_name": "Demo World",
    "source_preview_enabled": False,
    "row_version": 1,
    "policy_generation": 1,
    "status": "ready",
    "included": sorted(HISTORY.repos.keys()),
    "deleted": False,
}
ASSETS: dict[str, dict] = {}
WEBHOOK_SEEN: set[str] = set()
DELETIONS: dict[str, dict] = {}
JOB_KIND_RESULT = {"ingest": "world_version", "resolve_snapshot": "snapshot"}


def problem(status: int, code: str, title: str, detail: str = "") -> JSONResponse:
    return JSONResponse(
        status_code=status,
        media_type="application/problem+json",
        content={
            "type": f"urn:devworld:problem:{code.lower().replace('_', '-')}",
            "title": title,
            "status": status,
            "code": code,
            "detail": detail,
            "request_id": str(uuid.uuid4()),
            "retryable": status in (429, 503),
        },
    )


def semantic_level(kind: str, depth: int | None) -> str:
    if kind == "world":
        return "world"
    if kind == "repository":
        return "country"
    if kind == "directory":
        return "state" if depth == 1 else "district"
    if kind == "file":
        return "building"
    if kind in ("class", "component"):
        return "floor"
    return "room"


def repo_of(entity_key: str) -> str | None:
    if entity_key == "world-root":
        return None
    return HISTORY.entity_repo.get(entity_key)


def members_for(repo_key: str, oid: str) -> dict:
    return HISTORY.membership[(repo_key, oid)]


def resolve_snapshot_doc(scope_key: str, selector: dict, precision: str) -> tuple[dict, str]:
    """Resolve world time into one commit per included repository."""
    now_heads = selector.get("type") == "latest"
    explicit = selector.get("type") == "commit"
    repos: list[dict] = []
    coverage: set[str] = set()
    reasons: set[str] = set()
    for repo_key in DEMO_STATE["included"]:
        repo = HISTORY.repos[repo_key]
        lineage = HISTORY.lineages[repo_key]
        if now_heads:
            row = lineage[-1]
            status = "resolved"
        elif explicit:
            if selector.get("repository_id") != repo["entity_id"]:
                # Commit scope filters to its own repository only.
                continue
            match = next((r for r in lineage if r["oid"] == selector.get("oid")), None)
            if match is None:
                return (
                    {"error": ("unknown commit for the captured lineage", repo_key)},
                    "",
                )
            row = match
            status = "resolved"
        else:
            target = datetime.fromisoformat(selector["at"].replace("Z", "+00:00"))
            match = HISTORY.resolve_time(repo_key, target)
            if match is None:
                repos.append(
                    {
                        "repository_id": repo["entity_id"],
                        "status": "before_coverage",
                        "coverage": "partial",
                        "coverage_reasons": ["HISTORY_LIMIT"],
                        "oldest_indexed_at": repo["oldest_indexed_at"],
                        "newest_indexed_at": repo["newest_indexed_at"],
                    }
                )
                coverage.add("partial")
                reasons.add("HISTORY_LIMIT")
                continue
            row = match
            status = "resolved"
        snap_id = str(
            uuid.uuid5(
                uuid.NAMESPACE_URL,
                f"devworld:repo-snapshot:{repo_key}:{row['oid']}:{PIPELINE_HASH}",
            )
        )
        repos.append(
            {
                "repository_id": repo["entity_id"],
                "status": status,
                "object_format": "sha1",
                "resolved_commit_oid": row["oid"],
                "repo_snapshot_id": snap_id,
                "coverage": "partial",
                "coverage_reasons": ["HISTORY_LIMIT"],
                "oldest_indexed_at": repo["oldest_indexed_at"],
                "newest_indexed_at": repo["newest_indexed_at"],
            }
        )
        coverage.add("partial")
        reasons.add("HISTORY_LIMIT")
    if explicit and not repos:
        return ({"error": ("commit scope must name an included repository", "")}, "")
    snapshot_id = str(
        uuid.uuid5(
            uuid.NAMESPACE_URL,
            "devworld:snapshot:"
            + json.dumps(
                {
                    "v": WORLD_VERSION_ID,
                    "scope": scope_key,
                    "sel": selector,
                    "p": precision,
                    "repos": [
                        (r.get("repository_id"), r.get("resolved_commit_oid")) for r in repos
                    ],
                },
                sort_keys=True,
            ),
        )
    )
    doc = {
        "snapshot_id": snapshot_id,
        "world_id": WORLD_ID,
        "world_version_id": WORLD_VERSION_ID,
        "scope_entity_id": eu(scope_key) if scope_key != "world-root" else ROOT_ENTITY_ID,
        "scope_key": scope_key,
        "selector": selector,
        "precision": precision,
        "coverage": "partial",
        "coverage_reasons": sorted(reasons),
        "repositories": repos,
        "manifest_asset_id": None,
        "policy_generation": DEMO_STATE["policy_generation"],
    }
    STORE.put_snapshot(snapshot_id, doc)
    return doc, snapshot_id


def snapshot_members(doc: dict) -> dict[str, dict]:
    """All entity versions visible in a snapshot, keyed by entity key."""
    out: dict[str, dict] = {}
    scoped_repo: str | None = None
    scope_key = doc.get("scope_key", "world-root")
    if scope_key != "world-root":
        scoped_repo = repo_of(scope_key)
    for entry in doc["repositories"]:
        if entry["status"] != "resolved":
            continue
        repo_key = next(
            k for k, r in HISTORY.repos.items() if r["entity_id"] == entry["repository_id"]
        )
        if scoped_repo is not None and repo_key != scoped_repo:
            continue
        for key, ver in members_for(repo_key, entry["resolved_commit_oid"]).items():
            out[key] = ver
    return out


def to_detail(ver: dict, members: dict[str, dict]) -> dict:
    repo_key = repo_of(ver["entity_key"])
    kids = [k for k, v in members.items() if v["parent_key"] == ver["entity_key"]]
    bounds_rec = LAYOUT.get(repo_key or "")
    return {
        "entity_id": ver["id"],
        "repository_id": HISTORY.repos[repo_key]["entity_id"] if repo_key else None,
        "kind": ver["kind"],
        "version_id": ver["version_id"],
        "commit_oid": ver["commit_oid"],
        "semantic_level": semantic_level(ver["kind"], ver["directory_depth"]),
        "name": ver["name"],
        "path": ver["path"],
        "parent_entity_id": ver["parent_id"],
        "directory_depth": ver["directory_depth"],
        "language": ver["language"],
        "metrics": ver["metrics"],
        "analysis_status": ver["analysis_status"],
        "exclusion_reason": ver["exclusion_reason"],
        "bounds": {"anchor": bounds_rec["anchor"] if bounds_rec else None},
        "child_count": len(kids),
        "exists_at_snapshot": True,
    }


def ensure_tile_assets(doc: dict, lod: str, scope_key: str) -> list[dict]:
    """Build (or reuse) manifest tiles + instance payloads for a snapshot."""
    members = snapshot_members(doc)
    snapshot_id = doc["snapshot_id"]
    if lod == "L0":
        keys = [f"{rk}:repo" for rk in sorted(HISTORY.repos) if rk in DEMO_STATE["included"]]
        level, material = 0, "country"
    elif lod == "L1":
        repo_key = scope_key.split(":")[0] if scope_key != "world-root" else None
        if repo_key is None or repo_key not in HISTORY.repos:
            return []
        keys = sorted(
            k
            for k in members
            if members[k]["kind"] == "directory" and members[k]["directory_depth"] == 1
        ) + sorted(
            k
            for k in members
            if members[k]["kind"] == "file" and members[k]["parent_key"] == f"{repo_key}:repo"
        )
        level, material = 1, "state"
    elif lod == "L2":
        keys = sorted(
            k
            for k in members
            if members[k]["kind"] in ("directory", "file")
            and not (members[k]["kind"] == "directory" and members[k]["directory_depth"] == 1)
        )
        level, material = 2, "building"
    else:
        keys = sorted(
            k for k in members if members[k]["kind"] in ("class", "component", "function")
        )
        level, material = 3, "room"
    if scope_key != "world-root":

        def belongs_to_scope(key: str) -> bool:
            parent = members[key].get("parent_key")
            seen: set[str] = set()
            while parent and parent not in seen:
                if parent == scope_key:
                    return True
                seen.add(parent)
                parent = members.get(parent, {}).get("parent_key")
            return False

        keys = [key for key in keys if belongs_to_scope(key)]
    instances: list[dict] = []
    pick_map: dict[int, str] = {}
    for i, key in enumerate(keys):
        ver = members[key]
        repo_key = repo_of(key) or sorted(HISTORY.repos)[0]
        pos = layout_mod.child_position(LAYOUT, repo_key, i, max(1, len(keys)), level)
        mag = 0.03 + 0.01 * level
        if ver["kind"] == "file":
            mag = min(0.09, 0.02 + ver["metrics"].get("source_bytes", 0) / 20000.0)
        instances.append(
            {
                "position": list(pos),
                "scale": [mag, mag, mag],
                "material": tiles.material_index(
                    {
                        "repository": "country",
                        "directory": "state" if ver.get("directory_depth") == 1 else "district",
                        "file": "building",
                        "class": "floor",
                        "component": "floor",
                        "function": "room",
                    }.get(ver["kind"], material)
                ),
                "pick": i,
                "flags": 0,
            }
        )
        pick_map[i] = key
    payload = tiles.encode_instances(instances)
    tile_id = tiles.tile_uuid(snapshot_id, lod, scope_key)
    header_id = tiles.tile_uuid(snapshot_id, lod, scope_key, "header")
    payload_id = tiles.tile_uuid(snapshot_id, lod, scope_key, "payload")
    header_doc = tiles.header(
        snapshot_id=snapshot_id,
        tile_id=tile_id,
        lod=lod,
        instances=instances,
        payload=payload,
    )
    # Picking table: instance index -> authorized entity ID. Served inside
    # the tile header envelope so geometry never carries names or paths.
    header_doc["picks"] = [members[key]["id"] for key in keys]
    ASSETS[header_id] = {
        "snapshot_id": snapshot_id,
        "media": "application/json",
        "data": json.dumps(header_doc).encode(),
        "pick_map": pick_map,
    }
    ASSETS[payload_id] = {
        "snapshot_id": snapshot_id,
        "media": "application/octet-stream",
        "data": payload,
        "pick_map": pick_map,
    }
    bounds = {"center": [0, 0, 0], "radius": 1.1}
    return [
        {
            "tile_id": tile_id,
            "header_asset_id": header_id,
            "payload_asset_id": payload_id,
            "byte_length": len(payload),
            "uncompressed_byte_length": len(payload),
            "content_sha256": tiles.sha256_hex(payload),
            "bounds": bounds,
            "geometric_error": 0.08 if lod == "L0" else 0.03,
            "children": [],
        }
    ]


def create_app() -> FastAPI:
    app = FastAPI(title="DevWorld API", version="1.0.0")

    @app.get("/api/v1/health/live")
    def health_live():
        return {"status": "ok"}

    @app.get("/api/v1/health/ready")
    def health_ready():
        return {"status": "ready", "demo_mode": security.demo_mode()}

    # -- session / auth -------------------------------------------------

    @app.get("/api/v1/session")
    def get_session(response: Response):
        if security.demo_mode():
            response.set_cookie(
                security.DEV_COOKIE, "demo-session", httponly=True, samesite="lax", path="/"
            )
            return {
                "authenticated": True,
                "user": security.DEMO_USER,
                "csrf_token": "demo-csrf-token",
            }
        return {"authenticated": False, "user": None, "csrf_token": None}

    @app.get("/api/v1/auth/github/start")
    def github_start(return_to: str = "/"):
        allowed = {"/", "/world", "/demo"}
        if return_to not in allowed:
            return problem(400, "VALIDATION_ERROR", "Invalid return path.")
        if security.demo_mode():
            url = (
                "/api/v1/auth/github/callback"
                f"?code=demo-code&state=demo-state&return_to={return_to}"
            )
            return RedirectResponse(url=url, status_code=302)
        return problem(501, "FEATURE_NOT_ENABLED", "GitHub App is not configured for this build.")

    @app.get("/api/v1/auth/github/callback")
    def github_callback(code: str = "", state: str = "", return_to: str = "/"):
        if not security.demo_mode():
            return problem(
                501, "FEATURE_NOT_ENABLED", "GitHub App is not configured for this build."
            )
        if code != "demo-code" or state != "demo-state":
            return problem(400, "VALIDATION_ERROR", "Invalid demo callback.")
        resp = RedirectResponse(
            url=return_to if return_to.startswith("/") else "/", status_code=303
        )
        resp.set_cookie(
            security.DEV_COOKIE, "demo-session", httponly=True, samesite="lax", path="/"
        )
        return resp

    @app.post("/api/v1/auth/logout")
    def logout():
        resp = JSONResponse(status_code=204, content=None)
        resp.delete_cookie(security.DEV_COOKIE, path="/")
        return resp

    @app.get("/api/v1/connections")
    def list_connections():
        item = ConnectionItem(
            id=CONNECTION_ID,
            github_account_id="1",
            account_type="user",
            status="active",
            permission_checked_at=datetime.now(UTC).isoformat(),
        )
        return {"items": [item.model_dump()], "next_cursor": None}

    @app.get("/api/v1/connections/{connection_id}/repositories")
    def connection_repos(connection_id: str):
        if connection_id != CONNECTION_ID:
            return problem(404, "NOT_FOUND", "Connection not found.")
        items = [
            RepositoryItem(
                github_repository_id=r["github_id"],
                name=r["name"],
                visibility="public",
                archived=False,
                default_ref=r["default_ref"],
                eligible=True,
                inclusion_reason="selected" if k in DEMO_STATE["included"] else "available",
            ).model_dump()
            for k, r in HISTORY.repos.items()
        ]
        return {"items": items, "next_cursor": None}

    @app.delete("/api/v1/connections/{connection_id}")
    def delete_connection(connection_id: str, request: Request):
        if connection_id != CONNECTION_ID:
            return problem(404, "NOT_FOUND", "Connection not found.")
        key = request.headers.get("Idempotency-Key", "")
        if not key:
            return problem(400, "VALIDATION_ERROR", "Idempotency-Key is required.")
        job = STORE.create_job(
            owner=security.DEMO_USER["id"],
            kind="purge",
            idempotency_key=f"conn:{connection_id}:{key}",
            result_type="deletion",
            result_id=connection_id,
        )
        return JSONResponse(status_code=202, content={"job_id": job["id"], "status": "queued"})

    @app.post("/api/v1/webhooks/github")
    async def github_webhook(
        request: Request,
        x_hub_signature_256: str = Header(default=""),
        x_github_delivery: str = Header(default=""),
    ):
        body = await request.body()
        if len(body) > 5 * 1024 * 1024:
            return problem(413, "PAYLOAD_TOO_LARGE", "Webhook body too large.")
        import os

        secret = os.environ.get("DEVWORLD_GITHUB_WEBHOOK_SECRET", "test-webhook-secret").encode()
        if not x_hub_signature_256 or not security.verify_hmac_sha256(
            secret, body, x_hub_signature_256
        ):
            return problem(403, "ACTION_FORBIDDEN", "Invalid webhook signature.")
        if not x_github_delivery:
            return problem(400, "VALIDATION_ERROR", "Missing delivery ID.")
        if x_github_delivery in WEBHOOK_SEEN:
            return JSONResponse(status_code=202, content={"status": "duplicate"})
        WEBHOOK_SEEN.add(x_github_delivery)
        return JSONResponse(status_code=202, content={"status": "accepted"})

    # -- worlds ----------------------------------------------------------

    def _world_or_404(world_id: str):
        if world_id != WORLD_ID or DEMO_STATE["deleted"]:
            return None
        return True

    @app.get("/api/v1/worlds")
    def list_worlds():
        if DEMO_STATE["deleted"]:
            return {"items": [], "next_cursor": None}
        item = WorldSummary(
            id=WORLD_ID,
            display_name=DEMO_STATE["display_name"],
            status=DEMO_STATE["status"],
            active_version_id=WORLD_VERSION_ID,
            repository_count=len(DEMO_STATE["included"]),
            sync_status="ready",
        )
        return {"items": [item.model_dump()], "next_cursor": None}

    @app.post("/api/v1/worlds")
    async def create_world(request: Request):
        body = await request.json()
        if set(body) - {"connection_id", "github_repository_ids", "display_name"}:
            return problem(400, "VALIDATION_ERROR", "Unknown fields in request.")
        key = request.headers.get("Idempotency-Key", "")
        if not key:
            return problem(400, "VALIDATION_ERROR", "Idempotency-Key is required.")
        job = STORE.create_job(
            owner=security.DEMO_USER["id"],
            kind="ingest",
            idempotency_key=f"worlds:{key}",
            result_type="world_version",
            result_id=WORLD_VERSION_ID,
        )
        return JSONResponse(
            status_code=202,
            content={
                "world_id": WORLD_ID,
                "job_id": job["id"],
                "status": "indexing",
                "policy_generation": 1,
            },
        )

    @app.get("/api/v1/worlds/{world_id}")
    def get_world(world_id: str, response: Response):
        if _world_or_404(world_id) is None:
            return problem(404, "NOT_FOUND", "World not found.")
        response.headers["ETag"] = f'"{DEMO_STATE["row_version"]}"'
        countries = [
            {"repository_id": HISTORY.repos[k]["entity_id"], "name": HISTORY.repos[k]["name"]}
            for k in DEMO_STATE["included"]
        ]
        return WorldDetail(
            id=WORLD_ID,
            display_name=DEMO_STATE["display_name"],
            status=DEMO_STATE["status"],
            source_preview_enabled=DEMO_STATE["source_preview_enabled"],
            active_version_id=WORLD_VERSION_ID,
            policy_generation=DEMO_STATE["policy_generation"],
            row_version=DEMO_STATE["row_version"],
            countries=countries,
        ).model_dump()

    @app.put("/api/v1/worlds/{world_id}/repositories")
    async def put_repositories(world_id: str, request: Request):
        if _world_or_404(world_id) is None:
            return problem(404, "NOT_FOUND", "World not found.")
        match = request.headers.get("If-Match", "")
        if match != f'"{DEMO_STATE["row_version"]}"':
            return problem(412, "PRECONDITION_FAILED", "Stale ETag; reload the world first.")
        body = await request.json()
        ids = body.get("github_repository_ids", [])
        valid = {r["github_id"] for r in HISTORY.repos.values()}
        if any(i not in valid for i in ids):
            return problem(422, "VALIDATION_ERROR", "Unknown repository ID in selection.")
        key = request.headers.get("Idempotency-Key", "")
        if not key:
            return problem(400, "VALIDATION_ERROR", "Idempotency-Key is required.")
        DEMO_STATE["included"] = sorted(
            k for k, r in HISTORY.repos.items() if r["github_id"] in ids
        )
        DEMO_STATE["policy_generation"] += 1
        DEMO_STATE["row_version"] += 1
        job = STORE.create_job(
            owner=security.DEMO_USER["id"],
            kind="ingest",
            idempotency_key=f"repos:{world_id}:{key}",
            result_type="world_version",
            result_id=WORLD_VERSION_ID,
        )
        return JSONResponse(status_code=202, content={"job_id": job["id"], "status": "queued"})

    @app.patch("/api/v1/worlds/{world_id}/settings")
    async def patch_settings(world_id: str, request: Request, response: Response):
        if _world_or_404(world_id) is None:
            return problem(404, "NOT_FOUND", "World not found.")
        match = request.headers.get("If-Match", "")
        if match != f'"{DEMO_STATE["row_version"]}"':
            return problem(412, "PRECONDITION_FAILED", "Stale ETag; reload the world first.")
        body = await request.json()
        if set(body) - {"display_name", "source_preview_enabled"}:
            return problem(400, "VALIDATION_ERROR", "Unknown fields in request.")
        if "display_name" in body:
            DEMO_STATE["display_name"] = str(body["display_name"])[:120]
        if "source_preview_enabled" in body:
            DEMO_STATE["source_preview_enabled"] = bool(body["source_preview_enabled"])
        DEMO_STATE["row_version"] += 1
        response.headers["ETag"] = f'"{DEMO_STATE["row_version"]}"'
        return {
            "display_name": DEMO_STATE["display_name"],
            "source_preview_enabled": DEMO_STATE["source_preview_enabled"],
            "row_version": DEMO_STATE["row_version"],
        }

    @app.post("/api/v1/worlds/{world_id}/sync")
    async def sync_world(world_id: str, request: Request):
        if _world_or_404(world_id) is None:
            return problem(404, "NOT_FOUND", "World not found.")
        key = request.headers.get("Idempotency-Key", "")
        if not key:
            return problem(400, "VALIDATION_ERROR", "Idempotency-Key is required.")
        job = STORE.create_job(
            owner=security.DEMO_USER["id"],
            kind="ingest",
            idempotency_key=f"sync:{world_id}:{key}",
            result_type="world_version",
            result_id=WORLD_VERSION_ID,
        )
        return JSONResponse(status_code=202, content={"job_id": job["id"], "status": "queued"})

    @app.get("/api/v1/worlds/{world_id}/versions")
    def list_versions(world_id: str):
        if _world_or_404(world_id) is None:
            return problem(404, "NOT_FOUND", "World not found.")
        item = VersionSummary(
            id=WORLD_VERSION_ID,
            world_id=WORLD_ID,
            status="ready",
            published_at="2026-06-18T12:00:01Z",
            coverage="partial",
            coverage_reasons=["HISTORY_LIMIT"],
        )
        return {"items": [item.model_dump()], "next_cursor": None}

    @app.get("/api/v1/worlds/{world_id}/versions/{version_id}")
    def get_version(world_id: str, version_id: str):
        if _world_or_404(world_id) is None or version_id != WORLD_VERSION_ID:
            return problem(404, "NOT_FOUND", "Version not found.")
        heads = [
            {
                "repository_id": HISTORY.repos[k]["entity_id"],
                "captured_ref": HISTORY.repos[k]["default_ref"],
                "captured_head_oid": HISTORY.repos[k]["head_oid"],
                "coverage": "partial",
                "coverage_reasons": ["HISTORY_LIMIT"],
            }
            for k in DEMO_STATE["included"]
        ]
        return VersionDetail(
            id=WORLD_VERSION_ID,
            world_id=WORLD_ID,
            status="ready",
            published_at="2026-06-18T12:00:01Z",
            coverage="partial",
            coverage_reasons=["HISTORY_LIMIT"],
            captured_heads=heads,
            layout_epoch=1,
        ).model_dump()

    @app.delete("/api/v1/worlds/{world_id}")
    def delete_world(world_id: str, request: Request):
        if _world_or_404(world_id) is None:
            return problem(404, "NOT_FOUND", "World not found.")
        key = request.headers.get("Idempotency-Key", "")
        if not key:
            return problem(400, "VALIDATION_ERROR", "Idempotency-Key is required.")
        DEMO_STATE["deleted"] = True
        DEMO_STATE["policy_generation"] += 1
        deletion_id = str(uuid.uuid4())
        receipt = uuid.uuid4().hex
        DELETIONS[deletion_id] = {
            "status": "active_purged",
            "receipt_digest": hashlib.sha256(receipt.encode()).hexdigest(),
            "accepted_at": datetime.now(UTC).isoformat(),
        }
        job = STORE.create_job(
            owner=security.DEMO_USER["id"],
            kind="purge",
            idempotency_key=f"del-world:{world_id}:{key}",
            result_type="deletion",
            result_id=deletion_id,
        )
        return JSONResponse(
            status_code=202,
            content={"job_id": job["id"], "deletion_id": deletion_id, "receipt_token": receipt},
        )

    # -- snapshots ---------------------------------------------------------

    @app.post("/api/v1/worlds/{world_id}/snapshots/resolve")
    async def resolve_snapshot(world_id: str, request: Request):
        if _world_or_404(world_id) is None:
            return problem(404, "NOT_FOUND", "World not found.")
        key = request.headers.get("Idempotency-Key", "")
        if not key:
            return problem(400, "VALIDATION_ERROR", "Idempotency-Key is required.")
        try:
            req = ResolveRequest.model_validate(await request.json())
        except Exception:
            return problem(422, "VALIDATION_ERROR", "Invalid selector or fields.")
        if req.selector.type == "commit" and (
            not req.selector.repository_id or not req.selector.oid
        ):
            return problem(422, "VALIDATION_ERROR", "Commit selector needs repository_id and oid.")
        scope_key = "world-root"
        if req.scope_entity_id and req.scope_entity_id != ROOT_ENTITY_ID:
            found = next(
                (k for k, rid in _entity_ids().items() if rid == req.scope_entity_id), None
            )
            if found is None:
                return problem(404, "NOT_FOUND", "Scope entity not found.")
            if req.selector.type == "commit":
                repo_of_scope = repo_of(found)
                scope_repo_id = HISTORY.repos[repo_of_scope]["entity_id"] if repo_of_scope else None
                if scope_repo_id != req.selector.repository_id:
                    return problem(
                        422, "VALIDATION_ERROR", "Commit scope must stay in its repository."
                    )
            scope_key = found
        doc, snapshot_id = resolve_snapshot_doc(scope_key, req.selector.model_dump(), req.precision)
        if "error" in doc:
            detail, _ = doc["error"]
            return problem(422, "VALIDATION_ERROR", detail)
        if doc["policy_generation"] != DEMO_STATE["policy_generation"]:
            return problem(409, "VERSION_STALE", "World inclusion changed; resolve again.")
        out = Snapshot(
            snapshot_id=snapshot_id,
            world_id=doc["world_id"],
            world_version_id=doc["world_version_id"],
            scope_entity_id=doc["scope_entity_id"],
            selector=req.selector,
            precision=doc["precision"],  # type: ignore[arg-type]
            coverage=doc["coverage"],  # type: ignore[arg-type]
            coverage_reasons=doc["coverage_reasons"],
            repositories=[SnapshotRepository(**r) for r in doc["repositories"]],
            manifest_asset_id=doc["manifest_asset_id"],
        )
        return JSONResponse(status_code=200, content=out.model_dump())

    def _get_snapshot_or_404(snapshot_id: str):
        doc = STORE.get_snapshot(snapshot_id)
        if doc is None:
            return None, problem(404, "NOT_FOUND", "Snapshot not found.")
        if DEMO_STATE["deleted"]:
            return None, problem(404, "NOT_FOUND", "Snapshot not found.")
        if doc.get("policy_generation") != DEMO_STATE["policy_generation"]:
            return None, problem(409, "VERSION_STALE", "World inclusion changed; resolve again.")
        return doc, None

    @app.get("/api/v1/snapshots/{snapshot_id}")
    def get_snapshot(snapshot_id: str):
        doc, err = _get_snapshot_or_404(snapshot_id)
        if err is not None:
            return err
        assert doc is not None
        return {
            "snapshot_id": doc["snapshot_id"],
            "world_id": doc["world_id"],
            "world_version_id": doc["world_version_id"],
            "scope_entity_id": doc["scope_entity_id"],
            "selector": doc["selector"],
            "precision": doc["precision"],
            "coverage": doc["coverage"],
            "coverage_reasons": doc["coverage_reasons"],
            "repositories": doc["repositories"],
            "manifest_asset_id": doc["manifest_asset_id"],
        }

    @app.get("/api/v1/snapshots/{snapshot_id}/manifest")
    def get_manifest(
        snapshot_id: str,
        entity_id: str | None = None,
        lod: str = Query(default="L0"),
    ):
        doc, err = _get_snapshot_or_404(snapshot_id)
        if err is not None:
            return err
        assert doc is not None
        if lod not in ("L0", "L1", "L2", "L3"):
            return problem(400, "VALIDATION_ERROR", "Unknown LOD.")
        scope_key = doc.get("scope_key", "world-root")
        if entity_id and entity_id != ROOT_ENTITY_ID:
            found = next((k for k, rid in _entity_ids().items() if rid == entity_id), None)
            if found is None:
                return problem(404, "NOT_FOUND", "Entity not found.")
            scope_key = found
        tiles_out = ensure_tile_assets(doc, lod, scope_key)
        manifest = Manifest(
            snapshot_id=snapshot_id,
            layout_epoch=1,
            pipeline_hash=PIPELINE_HASH,
            lod=lod,  # type: ignore[arg-type]
            tiles=[ManifestTile(**t) for t in tiles_out],
        )
        return manifest.model_dump()

    @app.get("/api/v1/snapshots/{snapshot_id}/entities/{entity_id}")
    def get_entity(snapshot_id: str, entity_id: str):
        doc, err = _get_snapshot_or_404(snapshot_id)
        if err is not None:
            return err
        assert doc is not None
        members = snapshot_members(doc)
        by_id = {v["id"]: (k, v) for k, v in members.items()}
        if entity_id in by_id:
            key, ver = by_id[entity_id]
            return EntityDetail(**to_detail(ver, members)).model_dump()
        # Known entity absent at this time: nearest existing ancestor.
        key = next((k for k, rid in _entity_ids().items() if rid == entity_id), None)
        if key is None:
            return problem(404, "NOT_FOUND", "Entity not found.")
        ancestor: str | None = None
        cursor = key
        for _ in range(32):
            parent = _parent_of(cursor)
            if parent is None:
                break
            if parent == "world-root" or parent in members:
                ancestor = members[parent]["id"] if parent in members else ROOT_ENTITY_ID
                break
            cursor = parent
        return EntityDetail(
            entity_id=entity_id,
            repository_id=None,
            kind=_kind_of(key),
            semantic_level=semantic_level(_kind_of(key), _depth_of(key)),
            name=key.split(":")[-1],
            path=key,
            parent_entity_id=None,
            directory_depth=_depth_of(key),
            exists_at_snapshot=False,
            nearest_existing_ancestor_id=ancestor,
        ).model_dump()

    @app.get("/api/v1/snapshots/{snapshot_id}/entities/{entity_id}/children")
    def get_children(snapshot_id: str, entity_id: str, limit: int = 50, cursor: str | None = None):
        doc, err = _get_snapshot_or_404(snapshot_id)
        if err is not None:
            return err
        assert doc is not None
        members = snapshot_members(doc)
        if entity_id == ROOT_ENTITY_ID:
            keys = sorted(f"{rk}:repo" for rk in DEMO_STATE["included"] if f"{rk}:repo" in members)
        else:
            key = next((k for k, rid in _entity_ids().items() if rid == entity_id), None)
            if key is None or key not in members:
                return problem(404, "NOT_FOUND", "Entity not found.")
            kids = HISTORY.children.get((repo_of(key) or "", _commit_for(doc, key)), {}).get(
                key, []
            )
            keys = [k for k in kids if k in members]
            if not keys:
                keys = sorted(k for k, v in members.items() if v["parent_key"] == key)
        try:
            start = int(cursor) if cursor else 0
        except ValueError:
            return problem(400, "VALIDATION_ERROR", "Invalid cursor.")
        page = keys[start : start + max(1, min(100, limit))]
        nxt = str(start + len(page)) if start + len(page) < len(keys) else None
        return {
            "items": [EntityDetail(**to_detail(members[k], members)).model_dump() for k in page],
            "next_cursor": nxt,
        }

    @app.post("/api/v1/snapshots/{snapshot_id}/search")
    async def search(snapshot_id: str, request: Request):
        doc, err = _get_snapshot_or_404(snapshot_id)
        if err is not None:
            return err
        assert doc is not None
        try:
            req = SearchRequest.model_validate(await request.json())
        except Exception:
            return problem(422, "VALIDATION_ERROR", "Invalid search request.")
        members = snapshot_members(doc)
        if req.scope_entity_id and req.scope_entity_id != ROOT_ENTITY_ID:
            scope_key = next(
                (k for k, rid in _entity_ids().items() if rid == req.scope_entity_id), None
            )
            if scope_key is None:
                return problem(404, "NOT_FOUND", "Scope not found.")
            allowed = {scope_key} | {
                k for k, v in members.items() if _is_descendant(members, k, scope_key)
            }
        else:
            allowed = set(members)
        q = req.query.lower()
        hits: list[dict] = []
        for key in sorted(allowed):
            ver = members[key]
            if q in ver["name"].lower() or q in ver["path"].lower():
                hit: dict = {
                    "entity_id": ver["id"],
                    "kind": ver["kind"],
                    "semantic_level": semantic_level(ver["kind"], ver["directory_depth"]),
                    "name": ver["name"],
                    "path": ver["path"],
                    "exists_at_snapshot": True,
                }
                if req.include_history:
                    hist = HISTORY.entity_history(key)
                    if hist:
                        hit["first_known_appearance"] = hist[0]["committed_at"]
                hits.append(SearchHit(**hit).model_dump())
                if len(hits) >= req.limit:
                    break
        return {"items": hits, "next_cursor": None}

    @app.get("/api/v1/assets/{asset_id}")
    def get_asset(asset_id: str):
        rec = ASSETS.get(asset_id)
        if rec is None or DEMO_STATE["deleted"]:
            return problem(404, "NOT_FOUND", "Asset not found.")
        return Response(content=rec["data"], media_type=rec["media"])

    @app.post("/api/v1/snapshots/{snapshot_id}/source-preview")
    async def source_preview(snapshot_id: str, request: Request):
        doc, err = _get_snapshot_or_404(snapshot_id)
        if err is not None:
            return err
        assert doc is not None
        if not DEMO_STATE["source_preview_enabled"]:
            return problem(403, "SOURCE_PREVIEW_DISABLED", "Owner preview is disabled.")
        try:
            req = SourcePreviewRequest.model_validate(await request.json())
        except Exception:
            return problem(422, "VALIDATION_ERROR", "Invalid preview request.")
        if req.end_line < req.start_line:
            return problem(422, "VALIDATION_ERROR", "Invalid line range.")
        if req.end_line - req.start_line + 1 > 200:
            return problem(413, "PAYLOAD_TOO_LARGE", "Preview limited to 200 lines.")
        members = snapshot_members(doc)
        by_id = {v["id"]: (k, v) for k, v in members.items()}
        if req.entity_id not in by_id:
            return problem(404, "NOT_FOUND", "Entity not found.")
        key, ver = by_id[req.entity_id]
        file_ver = ver if ver["kind"] == "file" else members.get(ver["parent_key"], ver)
        while file_ver["kind"] not in ("file", "repository", "directory", "world"):
            file_ver = members.get(file_ver["parent_key"], file_ver)
            break
        if file_ver["kind"] != "file":
            return problem(422, "VALIDATION_ERROR", "Preview resolves to files only.")
        if file_ver["analysis_status"] != "ready":
            return problem(422, "VALIDATION_ERROR", "Outline unavailable for this file.")
        lines = (file_ver.get("source") or "").splitlines()
        start = max(1, req.start_line)
        end = min(len(lines), req.end_line)
        text = "\n".join(lines[start - 1 : end])
        if len(text.encode()) > 64 * 1024:
            text = text.encode()[: 64 * 1024].decode("utf-8", "ignore")
            truncated = True
        else:
            truncated = end < len(lines)
        preview = SourcePreview(
            entity_id=req.entity_id,
            file_entity_id=file_ver["id"],
            start_line=start,
            end_line=end,
            language=file_ver["language"],
            text=text,
            truncated=truncated,
        )
        return JSONResponse(
            content=preview.model_dump(),
            headers={"Cache-Control": "private, no-store"},
        )

    # -- timeline / history ------------------------------------------------

    @app.get("/api/v1/worlds/{world_id}/timeline")
    def get_timeline(
        world_id: str,
        world_version_id: str,
        scope_entity_id: str | None = None,
        from_: str | None = Query(default=None, alias="from"),
        to: str | None = Query(default=None, alias="to"),
        bucket: str = "month",
        limit: int = 50,
    ):
        if _world_or_404(world_id) is None or world_version_id != WORLD_VERSION_ID:
            return problem(404, "NOT_FOUND", "World or version not found.")
        if bucket not in ("day", "week", "month"):
            return problem(400, "VALIDATION_ERROR", "Unknown bucket.")
        scope_key = "world-root"
        if scope_entity_id and scope_entity_id != ROOT_ENTITY_ID:
            scope_key = next(
                (k for k, rid in _entity_ids().items() if rid == scope_entity_id), scope_key
            )
        scoped_repo = repo_of(scope_key)
        events: list[dict] = []
        for repo_key, evs in HISTORY.events.items():
            if scoped_repo and repo_key != scoped_repo:
                continue
            if repo_key not in DEMO_STATE["included"]:
                continue
            events.extend(evs)
        events.sort(key=lambda e: e["effective_at"])
        if from_ and to and from_ > to:
            return problem(400, "VALIDATION_ERROR", "from must be <= to.")
        buckets: dict[str, dict] = {}
        for e in events:
            if from_ and e["effective_at"] < from_:
                continue
            if to and e["effective_at"] > to:
                continue
            dt = datetime.fromisoformat(e["effective_at"].replace("Z", "+00:00"))
            if bucket == "day":
                key = dt.strftime("%Y-%m-%d")
            elif bucket == "week":
                key = dt.strftime("%Y-W%V")
            else:
                key = dt.strftime("%Y-%m")
            b = buckets.setdefault(key, {"change_count": 0, "kinds": {}})
            b["change_count"] += 1
            b["kinds"][e["operation"]] = b["kinds"].get(e["operation"], 0) + 1
        items = [
            {"bucket_start": k, "bucket_end": k, **v} for k, v in sorted(buckets.items())[:limit]
        ]
        markers = []
        for repo_key in DEMO_STATE["included"]:
            lineage = HISTORY.lineages[repo_key]
            markers.append(
                {
                    "kind": "creation",
                    "repository": HISTORY.repos[repo_key]["name"],
                    "at": lineage[0]["effective_at"],
                    "clock_adjusted": lineage[0]["clock_adjusted"],
                }
            )
        coverage = [
            {
                "repository": HISTORY.repos[k]["name"],
                "oldest_indexed_at": HISTORY.repos[k]["oldest_indexed_at"],
                "newest_indexed_at": HISTORY.repos[k]["newest_indexed_at"],
                "complete_to_root": True,
            }
            for k in DEMO_STATE["included"]
        ]
        return {"buckets": items, "markers": markers, "coverage": coverage}

    @app.get("/api/v1/snapshots/{snapshot_id}/entities/{entity_id}/history")
    def entity_history(snapshot_id: str, entity_id: str):
        doc, err = _get_snapshot_or_404(snapshot_id)
        if err is not None:
            return err
        key = next((k for k, rid in _entity_ids().items() if rid == entity_id), None)
        if key is None:
            return problem(404, "NOT_FOUND", "Entity not found.")
        items = [
            {
                "operation": e["operation"],
                "commit_oid": e["commit_oid"],
                "effective_at": e["effective_at"],
                "committed_at": e["committed_at"],
                "confidence": e["confidence"],
                "before_version_id": e["before_version_id"],
                "after_version_id": e["after_version_id"],
            }
            for e in HISTORY.entity_history(key)
        ]
        return {"items": items, "next_cursor": None}

    # -- jobs / SSE ----------------------------------------------------------

    @app.get("/api/v1/jobs/{job_id}")
    def get_job(job_id: str):
        job = STORE.get_job(job_id)
        if job is None:
            return problem(404, "NOT_FOUND", "Job not found.")
        result = None
        if job["result_type"] and job["result_id"]:
            result = {"type": job["result_type"], "id": job["result_id"]}
        return JobStatus(
            id=job["id"],
            kind=job["kind"],
            status=job["status"],
            stage=job["stage"],
            completed=job["progress_completed"],
            total=job["progress_total"],
            error_code=job["error_code"],
            result=result,  # type: ignore[arg-type]
        ).model_dump()

    @app.delete("/api/v1/jobs/{job_id}")
    def cancel_job(job_id: str):
        out = STORE.cancel_job(job_id)
        if out is None:
            return problem(404, "NOT_FOUND", "Job not found.")
        if out.get("conflict"):
            return problem(409, "JOB_NOT_CANCELLABLE", "Job already reached a terminal state.")
        return JSONResponse(status_code=202, content={"job_id": job_id, "status": "cancelled"})

    @app.post("/api/v1/jobs/{job_id}/retry")
    def retry_job(job_id: str, request: Request):
        job = STORE.get_job(job_id)
        if job is None:
            return problem(404, "NOT_FOUND", "Job not found.")
        key = request.headers.get("Idempotency-Key", "")
        if not key:
            return problem(400, "VALIDATION_ERROR", "Idempotency-Key is required.")
        if job["status"] != "failed":
            return problem(409, "JOB_NOT_CANCELLABLE", "Only failed jobs can be retried.")
        return JSONResponse(status_code=202, content={"job_id": job_id, "status": "queued"})

    @app.get("/api/v1/jobs/{job_id}/events")
    def job_events(job_id: str, last_event_id: int = -1):
        job = STORE.get_job(job_id)
        if job is None:
            return problem(404, "NOT_FOUND", "Job not found.")

        def stream():
            yield ": heartbeat\n\n"
            for evt in STORE.job_events(job_id, after=last_event_id):
                yield f"id: {evt['id']}\nevent: {evt['event']}\ndata: {json.dumps(evt['data'])}\n\n"

        return StreamingResponse(stream(), media_type="text/event-stream")

    # -- deletion / shares -----------------------------------------------------

    @app.delete("/api/v1/me")
    async def delete_me(request: Request):
        body = await request.json()
        if body.get("confirm") is not True:
            return problem(422, "VALIDATION_ERROR", "Deletion requires {confirm:true}.")
        key = request.headers.get("Idempotency-Key", "")
        if not key:
            return problem(400, "VALIDATION_ERROR", "Idempotency-Key is required.")
        DEMO_STATE["deleted"] = True
        DEMO_STATE["policy_generation"] += 1
        deletion_id = str(uuid.uuid4())
        receipt = uuid.uuid4().hex
        DELETIONS[deletion_id] = {
            "status": "active_purged",
            "receipt_digest": hashlib.sha256(receipt.encode()).hexdigest(),
            "accepted_at": datetime.now(UTC).isoformat(),
        }
        return JSONResponse(
            status_code=202,
            content={
                "deletion_id": deletion_id,
                "receipt_token": receipt,
                "active_purge_due_at": datetime.now(UTC).isoformat(),
                "backup_expiry_due_at": datetime.now(UTC).isoformat(),
            },
        )

    @app.get("/api/v1/deletions/{deletion_id}")
    def deletion_status(deletion_id: str, authorization: str = Header(default="")):
        rec = DELETIONS.get(deletion_id)
        if rec is None:
            return problem(404, "NOT_FOUND", "Deletion not found.")
        token = authorization.removeprefix("Bearer ").strip()
        if hashlib.sha256(token.encode()).hexdigest() != rec["receipt_digest"]:
            return problem(404, "NOT_FOUND", "Deletion not found.")
        return {
            "status": rec["status"],
            "accepted_at": rec["accepted_at"],
        }

    @app.get("/api/v1/worlds/{world_id}/repositories/{repository_id}/refs")
    def refs_disabled(world_id: str, repository_id: str):
        return problem(404, "NOT_FOUND", "Alternate branches are post-MVP.")

    @app.post("/api/v1/worlds/{world_id}/comparisons")
    def comparisons_disabled(world_id: str):
        return problem(404, "NOT_FOUND", "Comparison is post-MVP.")

    def _shares_disabled() -> JSONResponse:
        # Sharing stays disabled through MVP (SECURITY.md section 8).
        return problem(404, "NOT_FOUND", "Sharing is disabled in this release.")

    @app.get("/api/v1/worlds/{world_id}/shares")
    def shares_list_disabled(world_id: str) -> JSONResponse:
        _ = world_id
        return _shares_disabled()

    @app.post("/api/v1/worlds/{world_id}/shares")
    def shares_create_disabled(world_id: str) -> JSONResponse:
        _ = world_id
        return _shares_disabled()

    @app.delete("/api/v1/worlds/{world_id}/shares/{rest:path}")
    def shares_rest_disabled(world_id: str, rest: str = "") -> JSONResponse:
        _ = (world_id, rest)
        return _shares_disabled()

    return app


# -- small helpers used by routes -------------------------------------------


def _entity_ids() -> dict[str, str]:
    out = {"world-root": ROOT_ENTITY_ID}
    for members in HISTORY.membership.values():
        for key, ver in members.items():
            out.setdefault(key, ver["id"])
    return out


def _parent_of(key: str) -> str | None:
    for members in HISTORY.membership.values():
        if key in members:
            return members[key]["parent_key"]
    if key.endswith(":repo"):
        return "world-root"
    return None


def _kind_of(key: str) -> str:  # type: ignore[return]
    for members in HISTORY.membership.values():
        if key in members:
            return members[key]["kind"]
    if key.endswith(":repo"):
        return "repository"
    if ":dir:" in key:
        return "directory"
    if ":file:" in key:
        return "file"
    return "function"


def _depth_of(key: str) -> int | None:
    for members in HISTORY.membership.values():
        if key in members:
            return members[key]["directory_depth"]
    return None


def _commit_for(doc: dict, key: str) -> str:
    repo_key = repo_of(key)
    for entry in doc["repositories"]:
        repo = HISTORY.repos.get(repo_key or "")
        if repo and entry["repository_id"] == repo["entity_id"]:
            return entry.get("resolved_commit_oid") or ""
    return ""


def _is_descendant(members: dict[str, dict], key: str, ancestor: str) -> bool:
    cursor = members.get(key)
    for _ in range(64):
        if cursor is None:
            return False
        if cursor["parent_key"] == ancestor:
            return True
        cursor = members.get(cursor["parent_key"])
    return False


app = create_app()
