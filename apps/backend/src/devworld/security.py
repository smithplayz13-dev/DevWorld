"""Sessions, CSRF and demo-mode policy (SECURITY.md sections 3-4).

Hosted production uses a GitHub App with server-side token exchange; the
browser only ever sees an opaque HttpOnly session cookie plus a CSRF token.
Local ``DEMO_MODE`` serves the synthetic provider with a demo session so the
M1/M2 journeys run without credentials. Demo mode never touches real GitHub
credentials and is refused when production secrets are configured.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets

SESSION_COOKIE = "__Host-devworld_session"
DEV_COOKIE = "devworld_session_dev"
CSRF_HEADER = "X-CSRF-Token"

DEMO_USER = {
    "id": "00000000-0000-4000-8000-000000000001",
    "login": "demo-explorer",
    "display_name": "Demo Explorer",
}


def demo_mode() -> bool:
    return os.environ.get("DEVWORLD_DEMO_MODE", "true").lower() in ("1", "true", "yes")


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def constant_time_equal(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


def verify_hmac_sha256(secret: bytes, body: bytes, signature: str) -> bool:
    """Verify an ``X-Hub-Signature-256`` style ``sha256=<hex>`` signature."""
    expected = "sha256=" + hmac.new(secret, body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
