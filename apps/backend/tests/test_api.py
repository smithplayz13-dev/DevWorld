"""API contract tests against the synthetic provider (API_SPEC.md).

Covers snapshot resolution semantics, exact/partial coexistence, unknown
commit rejection, entity absence with nearest ancestor, search POST privacy
(terms stay out of URLs), source-preview gating and deletion denial.
"""

import uuid

from fastapi.testclient import TestClient

from devworld.api.main import WORLD_ID, WORLD_VERSION_ID, create_app
from devworld.history import WorldHistory
from devworld.showcase import build_showcase_specs

client = TestClient(create_app())
HISTORY = WorldHistory()
HEADERS = {"Idempotency-Key": "test-key"}


def _resolve(selector: dict, scope: str | None = None) -> dict:
    body = {
        "world_version_id": WORLD_VERSION_ID,
        "selector": selector,
        "precision": "exact",
    }
    if scope:
        body["scope_entity_id"] = scope
    response = client.post(
        f"/api/v1/worlds/{WORLD_ID}/snapshots/resolve",
        json=body,
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_resolve_latest_returns_per_repo_vector():
    snapshot = _resolve({"type": "latest"})
    assert snapshot["precision"] == "exact"
    assert snapshot["coverage"] == "partial"  # exact trees, limited history
    by_repo = {r["repository_id"]: r for r in snapshot["repositories"]}
    # Tiny-world repos plus the separate synthetic showcase repos.
    assert len(by_repo) == len(HISTORY.repos) + len(build_showcase_specs())
    for repo_key, repo in HISTORY.repos.items():
        entry = by_repo[repo["entity_id"]]
        assert entry["status"] == "resolved"
        assert entry["resolved_commit_oid"] == repo["head_oid"]


def test_resolve_time_vector_differs_per_repo():
    snapshot = _resolve({"type": "time", "at": "2026-05-01T00:00:00Z"})
    by_repo = {r["repository_id"]: r for r in snapshot["repositories"]}
    r3 = HISTORY.repos["r3"]["entity_id"]
    assert by_repo[r3]["status"] == "before_coverage"
    assert by_repo[r3]["resolved_commit_oid"] is None
    r1 = HISTORY.repos["r1"]["entity_id"]
    r2 = HISTORY.repos["r2"]["entity_id"]
    assert by_repo[r1]["status"] == "resolved"
    assert by_repo[r2]["status"] == "resolved"
    assert by_repo[r1]["resolved_commit_oid"] != by_repo[r2]["resolved_commit_oid"]


def test_unknown_commit_is_rejected():
    repo_id = HISTORY.repos["r1"]["entity_id"]
    response = client.post(
        f"/api/v1/worlds/{WORLD_ID}/snapshots/resolve",
        json={
            "world_version_id": WORLD_VERSION_ID,
            "selector": {"type": "commit", "repository_id": repo_id, "oid": "0" * 40},
            "precision": "exact",
        },
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert response.status_code == 422


def test_deleted_file_absent_with_ancestor():
    snapshot = _resolve({"type": "latest"})
    snapshot_id = snapshot["snapshot_id"]
    from devworld.synthetic import eu

    legacy_id = eu("r2:file:legacy")
    response = client.get(f"/api/v1/snapshots/{snapshot_id}/entities/{legacy_id}")
    assert response.status_code == 200
    body = response.json()
    assert body["exists_at_snapshot"] is False
    assert body["nearest_existing_ancestor_id"] is not None


def test_rename_visible_across_time():
    from devworld.synthetic import eu

    old = _resolve({"type": "time", "at": "2026-05-21T00:00:00Z"})
    new = _resolve({"type": "latest"})
    file_id = eu("r3:file:scales")
    old_body = client.get(f"/api/v1/snapshots/{old['snapshot_id']}/entities/{file_id}").json()
    new_body = client.get(f"/api/v1/snapshots/{new['snapshot_id']}/entities/{file_id}").json()
    assert old_body["path"] == "src/lib/scale.js"
    assert new_body["path"] == "src/lib/scales.js"
    assert old_body["entity_id"] == new_body["entity_id"]


def test_search_uses_post_body():
    snapshot = _resolve({"type": "latest"})
    response = client.post(
        f"/api/v1/snapshots/{snapshot['snapshot_id']}/search",
        json={"query": "chart", "limit": 10},
    )
    assert response.status_code == 200
    names = [hit["name"] for hit in response.json()["items"]]
    assert "Chart" in names or "Chart.tsx" in names


def test_source_preview_disabled_by_default():
    snapshot = _resolve({"type": "latest"})
    from devworld.synthetic import eu

    main_id = eu("r2:sym:main")
    response = client.post(
        f"/api/v1/snapshots/{snapshot['snapshot_id']}/source-preview",
        json={"entity_id": main_id, "start_line": 1, "end_line": 5},
    )
    assert response.status_code == 403
    assert response.json()["code"] == "SOURCE_PREVIEW_DISABLED"


def test_manifest_and_asset_roundtrip():
    snapshot = _resolve({"type": "latest"})
    manifest = client.get(
        f"/api/v1/snapshots/{snapshot['snapshot_id']}/manifest", params={"lod": "L0"}
    ).json()
    assert manifest["schema_version"] == 1
    assert len(manifest["tiles"]) == 1
    tile = manifest["tiles"][0]
    payload = client.get(f"/api/v1/assets/{tile['payload_asset_id']}")
    assert payload.status_code == 200
    assert len(payload.content) == tile["byte_length"]
    import hashlib

    assert hashlib.sha256(payload.content).hexdigest() == tile["content_sha256"]


def test_unknown_world_is_404_without_leak():
    response = client.get(f"/api/v1/worlds/{uuid.uuid4()}")
    assert response.status_code == 404
    assert "traceback" not in response.text.lower()


def test_idempotency_key_required():
    response = client.post(
        f"/api/v1/worlds/{WORLD_ID}/snapshots/resolve",
        json={"world_version_id": WORLD_VERSION_ID, "selector": {"type": "latest"}},
    )
    assert response.status_code == 400


def test_timeline_buckets_and_markers():
    response = client.get(
        f"/api/v1/worlds/{WORLD_ID}/timeline",
        params={"world_version_id": WORLD_VERSION_ID, "bucket": "month"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["buckets"]
    assert any(m["kind"] == "creation" for m in body["markers"])
    assert len(body["coverage"]) == len(HISTORY.repos) + len(build_showcase_specs())
