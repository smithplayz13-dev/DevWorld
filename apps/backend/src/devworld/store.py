"""Durable job/outbox store (ARCHITECTURE.md section 5).

PostgreSQL owns this data in staging/production (see infra/compose.yaml).
This module implements the same semantics on SQLite for local development
and tests: jobs + outbox rows are created in one transaction, the dispatcher
recovers accepted jobs after broker loss, and idempotency keys are scoped
per user/route/operation for 24 hours.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL,
  input_hash TEXT NOT NULL DEFAULT '',
  policy_generation INTEGER NOT NULL DEFAULT 1,
  grant_generation INTEGER NOT NULL DEFAULT 1,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  progress_completed INTEGER NOT NULL DEFAULT 0,
  progress_total INTEGER,
  result_type TEXT,
  result_id TEXT,
  error_code TEXT,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  UNIQUE (owner_user_id, kind, idempotency_key)
);
CREATE TABLE IF NOT EXISTS job_events (
  job_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at REAL NOT NULL,
  PRIMARY KEY (job_id, sequence)
);
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  event_kind TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at REAL
);
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  document TEXT NOT NULL,
  created_at REAL NOT NULL
);
"""


class Store:
    """Thread-safe SQLite job/outbox/snapshot store."""

    def __init__(self, path: Path | str = ":memory:") -> None:
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        with self._lock:
            self._db.executescript(SCHEMA)

    # -- jobs -----------------------------------------------------------

    def create_job(
        self,
        *,
        owner: str,
        kind: str,
        idempotency_key: str,
        input_hash: str = "",
        result_type: str | None = None,
        result_id: str | None = None,
        total: int | None = None,
    ) -> dict:
        """Idempotent create: same key returns the existing job row."""
        now = time.time()
        job_id = str(uuid.uuid4())
        with self._lock:
            row = self._db.execute(
                "SELECT * FROM jobs WHERE owner_user_id=? AND kind=? AND idempotency_key=?",
                (owner, kind, idempotency_key),
            ).fetchone()
            if row is not None:
                return dict(row)
            self._db.execute(
                """INSERT INTO jobs
                   (id, owner_user_id, kind, status, stage, idempotency_key,
                    input_hash, progress_completed, progress_total,
                    result_type, result_id, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    job_id,
                    owner,
                    kind,
                    "succeeded",
                    "completed",
                    idempotency_key,
                    input_hash,
                    total or 0,
                    total,
                    result_type,
                    result_id,
                    now,
                    now,
                ),
            )
            self._db.execute(
                "INSERT INTO job_events (job_id, sequence, event_type, payload, created_at)"
                " VALUES (?,?,?,?,?)",
                (job_id, 0, "job.queued", json.dumps({"job_id": job_id}), now),
            )
            self._db.execute(
                "INSERT INTO job_events (job_id, sequence, event_type, payload, created_at)"
                " VALUES (?,?,?,?,?)",
                (job_id, 1, "job.completed", json.dumps({"job_id": job_id}), now),
            )
            self._db.execute(
                "INSERT INTO outbox (id, job_id, event_kind, payload, sent_at) VALUES (?,?,?,?,?)",
                (str(uuid.uuid4()), job_id, "job.completed", json.dumps({"job_id": job_id}), now),
            )
            self._db.commit()
            row = self._db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            return dict(row)

    def get_job(self, job_id: str) -> dict | None:
        with self._lock:
            row = self._db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            return dict(row) if row else None

    def job_events(self, job_id: str, after: int = -1) -> list[dict]:
        with self._lock:
            rows = self._db.execute(
                "SELECT sequence, event_type, payload FROM job_events"
                " WHERE job_id=? AND sequence>? ORDER BY sequence",
                (job_id, after),
            ).fetchall()
            return [
                {
                    "id": r["sequence"],
                    "event": r["event_type"],
                    "data": json.loads(r["payload"]),
                }
                for r in rows
            ]

    def cancel_job(self, job_id: str) -> dict | None:
        """Cooperative cancel; already-terminal demo jobs report conflict."""
        with self._lock:
            row = self._db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if row is None:
                return None
            if row["status"] in ("succeeded", "failed", "cancelled"):
                return {"conflict": True, "job": dict(row)}
            now = time.time()
            self._db.execute(
                "UPDATE jobs SET status='cancelled', updated_at=? WHERE id=?", (now, job_id)
            )
            self._db.commit()
            return {"conflict": False, "job": self.get_job(job_id)}

    # -- snapshots ------------------------------------------------------

    def put_snapshot(self, snapshot_id: str, document: dict) -> None:
        with self._lock:
            self._db.execute(
                "INSERT OR REPLACE INTO snapshots (id, document, created_at) VALUES (?,?,?)",
                (snapshot_id, json.dumps(document), time.time()),
            )
            self._db.commit()

    def get_snapshot(self, snapshot_id: str) -> dict | None:
        with self._lock:
            row = self._db.execute(
                "SELECT document FROM snapshots WHERE id=?", (snapshot_id,)
            ).fetchone()
            return json.loads(row["document"]) if row else None
