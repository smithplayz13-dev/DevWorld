// API types mirror packages/contracts (API_SPEC.md, snake_case wire format).
export type EntityKind =
  "world" | "repository" | "directory" | "file" | "class" | "component" | "function";
export type SemanticLevel =
  "world" | "country" | "state" | "district" | "building" | "floor" | "room";
export type Precision = "exact" | "preview";
export type Coverage = "complete" | "partial";
export type Lod = "L0" | "L1" | "L2" | "L3";

export interface Selector {
  type: "latest" | "time" | "commit";
  at?: string;
  repository_id?: string;
  oid?: string;
}

export interface SnapshotRepository {
  repository_id: string;
  status: string;
  object_format: string;
  resolved_commit_oid: string | null;
  repo_snapshot_id: string | null;
  coverage: Coverage;
  coverage_reasons: string[];
  oldest_indexed_at: string | null;
  newest_indexed_at: string | null;
}

export interface SnapshotDoc {
  snapshot_id: string;
  world_id: string;
  world_version_id: string;
  scope_entity_id: string;
  selector: Selector;
  precision: Precision;
  coverage: Coverage;
  coverage_reasons: string[];
  repositories: SnapshotRepository[];
  manifest_asset_id: string | null;
}

export interface EntityDetail {
  entity_id: string;
  repository_id: string | null;
  kind: EntityKind;
  version_id: string | null;
  commit_oid: string | null;
  semantic_level: SemanticLevel;
  name: string;
  path: string;
  parent_entity_id: string | null;
  directory_depth: number | null;
  language: string | null;
  metrics: Record<string, number>;
  analysis_status: string;
  exclusion_reason: string | null;
  bounds: { anchor?: { lat: number; lon: number; xyz: number[] } } | null;
  child_count: number;
  exists_at_snapshot: boolean;
  nearest_existing_ancestor_id: string | null;
}

export interface ManifestTile {
  tile_id: string;
  header_asset_id: string;
  payload_asset_id: string;
  byte_length: number;
  uncompressed_byte_length: number;
  content_sha256: string;
  bounds: { center: number[]; radius: number };
  geometric_error: number;
  children: string[];
}

export interface ManifestDoc {
  schema_version: number;
  snapshot_id: string;
  layout_epoch: number;
  pipeline_hash: string;
  coordinate_frame: Record<string, unknown>;
  lod: string;
  tiles: ManifestTile[];
}

export interface WorldInfo {
  id: string;
  display_name: string;
  status: string;
  active_version_id: string | null;
  repository_count: number;
}

export const WORLD_TYPE_LABEL: Record<string, string> = {
  world: "World · GitHub account",
  repository: "Country · Repository",
  directory: "Region · Folder",
  file: "Building · File",
  class: "Floor · Class",
  component: "Floor · Component",
  function: "Room · Function",
};
