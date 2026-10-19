"""History construction and time resolution (DATA.md section 7).

Builds materialized per-commit membership from the synthetic specs, derives
first-parent change events, and resolves as-of views with the monotonic
``effective_at`` rule. There is no account-wide commit: world time resolves
one commit per repository.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, datetime

from .synthetic import NAMESPACE as NAMESPACE_UUID
from .synthetic import CommitState, RepoSpec, build_specs, commit_oid, eu


def _parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _fmt_ts(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _dir_keys(repo_key: str, path: str) -> list[tuple[str, str, int]]:
    """Return (entity_key, dir_path, depth) for every ancestor directory."""
    parts = path.split("/")[:-1]
    out = []
    for i in range(1, len(parts) + 1):
        dirpath = "/".join(parts[:i])
        out.append((f"{repo_key}:dir:{dirpath}", dirpath, i))
    return out


def _metrics(source: str) -> dict:
    lines = source.count("\n")
    return {
        "source_bytes": len(source.encode("utf-8")),
        "source_lines": lines,
    }


class WorldHistory:
    """Fully materialized synthetic history for the demo world."""

    def __init__(self, specs: list[RepoSpec] | None = None) -> None:
        self.specs = specs if specs is not None else build_specs()
        # repo_key -> repo record
        self.repos: dict[str, dict] = {}
        # (repo_key, commit_oid) -> {entity_key: version_record}
        self.membership: dict[tuple[str, str], dict[str, dict]] = {}
        # (repo_key, commit_oid) -> children map {parent_key: [entity_key]}
        self.children: dict[tuple[str, str], dict[str, list[str]]] = {}
        # repo_key -> lineage rows (ordinal, oids, times, skew flags)
        self.lineages: dict[str, list[dict]] = {}
        # repo_key -> list of change events (ordered by ordinal)
        self.events: dict[str, list[dict]] = {}
        # entity_key -> repo_key
        self.entity_repo: dict[str, str] = {}
        for spec in self.specs:
            self._build_repo(spec)

    # -- construction ----------------------------------------------------

    def _build_repo(self, spec: RepoSpec) -> None:
        repo_entity = eu(f"{spec.key}:repo")
        self.entity_repo[f"{spec.key}:repo"] = spec.key
        lineage: list[dict] = []
        events: list[dict] = []
        prev_members: dict[str, dict] = {}
        running_max: datetime | None = None
        # Register before the loop: _diff/_event resolve effective_at live.
        self.lineages[spec.key] = lineage
        for ordinal, commit in enumerate(spec.commits):
            oid = commit_oid(spec.key, commit.name)
            committed = _parse_ts(commit.committed_at)
            if running_max is None or committed > running_max:
                running_max = committed
                adjusted = False
            else:
                adjusted = True
            effective = running_max
            assert effective is not None
            lineage.append(
                {
                    "ordinal": ordinal,
                    "name": commit.name,
                    "oid": oid,
                    "committed_at": commit.committed_at,
                    "effective_at": _fmt_ts(effective),
                    "clock_adjusted": adjusted,
                }
            )
            members = self._materialize_commit(spec, commit, oid, repo_entity)
            self.membership[(spec.key, oid)] = members
            kids: dict[str, list[str]] = {}
            for key, ver in members.items():
                kids.setdefault(ver["parent_key"], []).append(key)
            for key in kids:
                kids[key] = sorted(kids[key])
            self.children[(spec.key, oid)] = kids
            if ordinal > 0:
                parent_oid = lineage[ordinal - 1]["oid"]
                events.extend(self._diff(spec.key, commit, parent_oid, oid, prev_members, members))
            prev_members = members
        self.events[spec.key] = events
        oldest = lineage[0]["effective_at"]
        newest = lineage[-1]["effective_at"]
        self.repos[spec.key] = {
            "key": spec.key,
            "name": spec.name,
            "github_id": spec.github_id,
            "language": spec.language,
            "default_ref": spec.default_ref,
            "entity_id": repo_entity,
            "head_oid": lineage[-1]["oid"],
            "oldest_indexed_at": oldest,
            "newest_indexed_at": newest,
            "commit_count": len(lineage),
        }

    def _materialize_commit(
        self, spec: RepoSpec, commit: CommitState, oid: str, repo_entity: str
    ) -> dict[str, dict]:
        members: dict[str, dict] = {}

        def definition_id(entity_key: str, *fields: object) -> str:
            """Content-addressed version ID (DATA_MODEL definition_hash).

            Unchanged content reuses the same version across commits, so
            checkpoint replay only advances versions that actually changed.
            """
            digest = hashlib.sha256()
            for part in fields:
                digest.update(str(part).encode("utf-8") + b"\x00")
            return str(uuid.uuid5(NAMESPACE_UUID, f"version:{entity_key}:{digest.hexdigest()}"))

        def put(
            entity_key: str,
            kind: str,
            name: str,
            path: str,
            parent_key: str,
            depth: int | None = None,
            language: str | None = None,
            metrics: dict | None = None,
            analysis: str = "ready",
            exclusion: str | None = None,
            start_line: int | None = None,
            end_line: int | None = None,
            source: str | None = None,
        ) -> None:
            self.entity_repo[entity_key] = spec.key
            members[entity_key] = {
                "id": eu(entity_key),
                "version_id": definition_id(
                    entity_key,
                    kind,
                    name,
                    path,
                    parent_key,
                    language,
                    metrics,
                    analysis,
                    start_line,
                    end_line,
                    source if kind in ("file",) else "",
                ),
                "entity_key": entity_key,
                "parent_key": parent_key,
                "parent_id": eu(parent_key),
                "kind": kind,
                "name": name,
                "path": path,
                "directory_depth": depth,
                "language": language,
                "metrics": metrics or {},
                "analysis_status": analysis,
                "exclusion_reason": exclusion,
                "start_line": start_line,
                "end_line": end_line,
                "source": source,
                "commit_oid": oid,
            }

        repo_key = f"{spec.key}:repo"
        put(
            repo_key,
            "repository",
            spec.name,
            spec.name,
            "world-root",
            language=spec.language,
        )
        seen_dirs: set[str] = set()
        for f in commit.files:
            for dir_key, dirpath, depth in _dir_keys(spec.key, f.path):
                if dir_key in seen_dirs:
                    continue
                seen_dirs.add(dir_key)
                parent = (
                    repo_key
                    if depth == 1
                    else f"{spec.key}:dir:{'/'.join(dirpath.split('/')[:-1])}"
                )
                put(
                    dir_key,
                    "directory",
                    dirpath.split("/")[-1],
                    dirpath,
                    parent,
                    depth=depth,
                )
            parent_key = repo_key
            if "/" in f.path:
                parent_key = f"{spec.key}:dir:{f.path.rsplit('/', 1)[0]}"
            symbol_count = len(f.symbols)
            file_metrics = _metrics(f.source)
            file_metrics["symbol_count"] = symbol_count
            put(
                f.key,
                "file",
                f.path.split("/")[-1],
                f.path,
                parent_key,
                language=f.language,
                metrics=file_metrics,
                analysis=f.analysis,
                exclusion=f.exclusion_reason,
                source=f.source,
            )
            for sym in f.symbols:
                sym_parent_key = f.key
                if sym.parent_symbol is not None:
                    sym_parent_key = sym.parent_symbol
                sym_metrics = {"source_lines": sym.end_line - sym.start_line + 1}
                put(
                    sym.key,
                    sym.kind,
                    sym.name,
                    f.path,
                    sym_parent_key,
                    language=f.language,
                    metrics=sym_metrics,
                    start_line=sym.start_line,
                    end_line=sym.end_line,
                )
        return members

    def _diff(
        self,
        repo_key: str,
        commit: CommitState,
        parent_oid: str,
        oid: str,
        before: dict[str, dict],
        after: dict[str, dict],
    ) -> list[dict]:
        events: list[dict] = []
        before_keys = set(before)
        after_keys = set(after)
        for key in sorted(after_keys - before_keys):
            events.append(self._event(repo_key, commit, parent_oid, "added", key, None, after[key]))
        for key in sorted(before_keys - after_keys):
            events.append(
                self._event(repo_key, commit, parent_oid, "removed", key, before[key], None)
            )
        for key in sorted(before_keys & after_keys):
            b, a = before[key], after[key]
            if b["path"] != a["path"]:
                op = "renamed"
            elif (b.get("source") or "") != (a.get("source") or ""):
                op = "modified"
            elif b["parent_key"] != a["parent_key"]:
                op = "moved"
            else:
                continue
            events.append(self._event(repo_key, commit, parent_oid, op, key, b, a))
        return events

    def _event(
        self,
        repo_key: str,
        commit: CommitState,
        parent_oid: str,
        operation: str,
        key: str,
        before: dict | None,
        after: dict | None,
    ) -> dict:
        oid = commit_oid(repo_key, commit.name)
        return {
            "repository": repo_key,
            "commit_oid": oid,
            "parent_oid": parent_oid,
            "entity_key": key,
            "entity_id": eu(key),
            "operation": operation,
            "confidence": "exact",
            "before_version_id": before["version_id"] if before else None,
            "after_version_id": after["version_id"] if after else None,
            "effective_at": self._effective(repo_key, oid),
            "committed_at": commit.committed_at,
        }

    # -- queries ----------------------------------------------------------

    def _effective(self, repo_key: str, oid: str) -> str:
        for row in self.lineages[repo_key]:
            if row["oid"] == oid:
                return row["effective_at"]
        raise KeyError(oid)

    def resolve_time(self, repo_key: str, target: datetime) -> dict | None:
        """Highest ordinal with effective_at <= target, else None."""
        best: dict | None = None
        for row in self.lineages[repo_key]:
            if _parse_ts(row["effective_at"]) <= target:
                best = row
        return best

    def membership_fingerprint(self, repo_key: str, oid: str) -> str:
        members = self.membership[(repo_key, oid)]
        digest = hashlib.sha256()
        for key in sorted(members):
            digest.update(f"{key}={members[key]['version_id']}".encode())
        return digest.hexdigest()

    def entity_history(self, entity_key: str) -> list[dict]:
        repo_key = self.entity_repo.get(entity_key)
        if repo_key is None:
            return []
        return [e for e in self.events[repo_key] if e["entity_key"] == entity_key]
