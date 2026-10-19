"""Security boundary tests (SECURITY.md): webhooks, CSRF-adjacent preview,
cross-user 404s, share-disabled routes and deletion receipts."""

import hashlib
import hmac
import json
import uuid

from fastapi.testclient import TestClient

from devworld.api.main import WORLD_ID, create_app

client = TestClient(create_app())


def _sig(body: bytes) -> str:
    return "sha256=" + hmac.new(b"test-webhook-secret", body, hashlib.sha256).hexdigest()


def test_webhook_rejects_bad_signature():
    body = b'{"action":"push"}'
    response = client.post(
        "/api/v1/webhooks/github",
        content=body,
        headers={"X-Hub-Signature-256": "sha256=dead", "X-GitHub-Delivery": "d1"},
    )
    assert response.status_code == 403


def test_webhook_accepts_then_dedupes():
    body = json.dumps({"action": "push"}).encode()
    headers = {"X-Hub-Signature-256": _sig(body), "X-GitHub-Delivery": "dw-test-1"}
    first = client.post("/api/v1/webhooks/github", content=body, headers=headers)
    second = client.post("/api/v1/webhooks/github", content=body, headers=headers)
    assert first.status_code == 202
    assert second.status_code == 202
    assert second.json()["status"] == "duplicate"


def test_unknown_connection_is_404():
    response = client.get(f"/api/v1/connections/{uuid.uuid4()}/repositories")
    assert response.status_code == 404


def test_shares_stay_disabled():
    for method in ("get", "post"):
        response = getattr(client, method)(f"/api/v1/worlds/{WORLD_ID}/shares")
        assert response.status_code == 404
    response = client.post(f"/api/v1/worlds/{WORLD_ID}/comparisons")
    assert response.status_code == 404


def test_deletion_receipt_is_bearer_scoped():
    response = client.request(
        "DELETE",
        "/api/v1/me",
        json={"confirm": True},
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert response.status_code == 202
    deletion_id = response.json()["deletion_id"]
    # Wrong token learns nothing.
    bad = client.get(f"/api/v1/deletions/{deletion_id}", headers={"Authorization": "Bearer wrong"})
    assert bad.status_code == 404
