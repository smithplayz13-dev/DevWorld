"""Worker entry points (ARCHITECTURE.md section 5).

Production runs Celery + Redis with PostgreSQL jobs/outbox as authoritative
state (see infra/compose.yaml). The demo/local worker executes the same
stage functions in-process through :mod:`devworld.store`. Importing this
module must never require broker credentials.
"""

from __future__ import annotations

try:  # Celery is a staging/production dependency, optional locally.
    from celery import Celery

    celery_app = Celery("devworld")
    celery_app.conf.update(
        task_acks_late=True,
        task_reject_on_worker_lost=True,
        worker_prefetch_multiplier=1,
    )
    app = celery_app
except Exception:  # pragma: no cover - local demo without celery installed
    app = None  # type: ignore[assignment]


def run_stage(job_id: str, stage: str) -> dict:
    """Execute one idempotent job stage keyed by (world, repo, oid, stage).

    Demo implementation: stages are no-ops that report completion because
    the synthetic provider is already materialized. Real ingestion stages
    (fetch-tree, parse-blobs, derive-history, build-layout, publish) plug in
    here behind the same idempotency contract.
    """
    return {"job_id": job_id, "stage": stage, "status": "succeeded"}
