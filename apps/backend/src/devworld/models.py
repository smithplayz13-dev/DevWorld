"""DevWorld API schemas.

These Pydantic models are the wire contract for ``/api/v1`` (API_SPEC.md).
JSON keys use snake_case. Internal IDs are UUID strings, GitHub numeric IDs
are decimal strings, timestamps are UTC RFC 3339.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

Kind = Literal["world", "repository", "directory", "file", "class", "component", "function"]
SemanticLevel = Literal["world", "country", "state", "district", "building", "floor", "room"]
Precision = Literal["exact", "preview"]
Coverage = Literal["complete", "partial"]
Status = Literal["resolved", "not_yet_created", "before_coverage", "empty", "unavailable"]
Lod = Literal["L0", "L1", "L2", "L3"]
AnalysisStatus = Literal["ready", "unsupported", "failed", "excluded", "pending"]


class Problem(BaseModel):
    type: str
    title: str
    status: int
    code: str
    detail: str = ""
    request_id: str = ""
    retryable: bool = False


class Page(BaseModel):
    items: list[Any]
    next_cursor: str | None = None


class SessionInfo(BaseModel):
    authenticated: bool
    user: dict[str, Any] | None = None
    csrf_token: str | None = None


class ConnectionItem(BaseModel):
    id: str
    github_account_id: str
    account_type: str
    status: str
    permission_checked_at: str | None = None


class RepositoryItem(BaseModel):
    github_repository_id: str
    name: str
    visibility: str
    archived: bool = False
    default_ref: str | None = None
    eligible: bool = True
    inclusion_reason: str = "selected"


class WorldSummary(BaseModel):
    id: str
    display_name: str
    status: str
    active_version_id: str | None = None
    repository_count: int = 0
    sync_status: str = "ready"


class WorldDetail(BaseModel):
    id: str
    display_name: str
    status: str
    source_preview_enabled: bool = False
    active_version_id: str | None = None
    policy_generation: int = 1
    row_version: int = 1
    countries: list[dict[str, Any]] = Field(default_factory=list)


class VersionSummary(BaseModel):
    id: str
    world_id: str
    status: Literal["preview", "ready"]
    published_at: str
    coverage: Coverage
    coverage_reasons: list[str] = Field(default_factory=list)
    manifest_asset_id: str | None = None


class VersionDetail(VersionSummary):
    captured_heads: list[dict[str, Any]] = Field(default_factory=list)
    layout_epoch: int = 1


class Selector(BaseModel):
    type: Literal["latest", "time", "commit"]
    at: str | None = None
    repository_id: str | None = None
    oid: str | None = None


class ResolveRequest(BaseModel):
    world_version_id: str
    scope_entity_id: str | None = None
    selector: Selector
    precision: Precision = "exact"


class SnapshotRepository(BaseModel):
    repository_id: str
    status: Status
    object_format: str = "sha1"
    resolved_commit_oid: str | None = None
    repo_snapshot_id: str | None = None
    coverage: Coverage = "complete"
    coverage_reasons: list[str] = Field(default_factory=list)
    oldest_indexed_at: str | None = None
    newest_indexed_at: str | None = None


class Snapshot(BaseModel):
    snapshot_id: str
    world_id: str
    world_version_id: str
    scope_entity_id: str
    selector: Selector
    precision: Precision
    coverage: Coverage
    coverage_reasons: list[str] = Field(default_factory=list)
    repositories: list[SnapshotRepository] = Field(default_factory=list)
    manifest_asset_id: str | None = None


class EntityDetail(BaseModel):
    entity_id: str
    repository_id: str | None = None
    kind: Kind
    version_id: str | None = None
    commit_oid: str | None = None
    semantic_level: SemanticLevel
    name: str
    path: str
    parent_entity_id: str | None = None
    directory_depth: int | None = None
    language: str | None = None
    metrics: dict[str, Any] = Field(default_factory=dict)
    analysis_status: AnalysisStatus = "ready"
    exclusion_reason: str | None = None
    bounds: dict[str, Any] | None = None
    child_count: int = 0
    exists_at_snapshot: bool = True
    nearest_existing_ancestor_id: str | None = None


class ManifestTile(BaseModel):
    tile_id: str
    header_asset_id: str
    payload_asset_id: str
    byte_length: int
    uncompressed_byte_length: int
    content_sha256: str
    bounds: dict[str, Any]
    geometric_error: float = 0.05
    children: list[str] = Field(default_factory=list)


class Manifest(BaseModel):
    schema_version: int = 1
    snapshot_id: str
    layout_epoch: int = 1
    pipeline_hash: str = ""
    coordinate_frame: dict[str, Any] = Field(
        default_factory=lambda: {"type": "world", "globe_radius": 1}
    )
    lod: Lod = "L0"
    tiles: list[ManifestTile] = Field(default_factory=list)


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=200)
    scope_entity_id: str | None = None
    include_history: bool = False
    limit: int = Field(default=50, ge=1, le=100)
    cursor: str | None = None


class SearchHit(BaseModel):
    entity_id: str
    kind: Kind
    semantic_level: SemanticLevel
    name: str
    path: str
    exists_at_snapshot: bool = True
    first_known_appearance: str | None = None


class SourcePreviewRequest(BaseModel):
    entity_id: str
    start_line: int = Field(ge=1)
    end_line: int = Field(ge=1)


class SourcePreview(BaseModel):
    entity_id: str
    file_entity_id: str
    start_line: int
    end_line: int
    language: str | None = None
    text: str
    truncated: bool = False


class JobAccepted(BaseModel):
    job_id: str
    status: str


class JobStatus(BaseModel):
    id: str
    kind: str
    status: str
    stage: str = ""
    completed: int = 0
    total: int | None = None
    error_code: str | None = None
    retryable: bool = False
    result: dict[str, Any] | None = None


class TimelineBucket(BaseModel):
    bucket_start: str
    bucket_end: str
    change_count: int
    kinds: dict[str, int] = Field(default_factory=dict)


class HistoryItem(BaseModel):
    operation: str
    commit_oid: str
    effective_at: str
    committed_at: str
    confidence: str = "exact"
    before_version_id: str | None = None
    after_version_id: str | None = None
