// Same-origin fetch wrapper for /api/v1 (API_SPEC.md global conventions).
// Search uses POST bodies so private terms stay out of URLs and access logs.
const BASE = "/api/v1";

export interface ProblemError extends Error {
  status: number;
  code: string;
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `key-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  const csrf = sessionStorage.getItem("dw-csrf");
  if (csrf) headers.set("X-CSRF-Token", csrf);
  const response = await fetch(`${BASE}${path}`, { ...init, headers });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.title ?? `Request failed (${response.status})`) as ProblemError;
    error.status = response.status;
    error.code = data.code ?? "UNKNOWN";
    throw error;
  }
  return data as T;
}

export const api = {
  session: () =>
    request<{ authenticated: boolean; user: unknown; csrf_token: string | null }>("/session"),
  worlds: () => request<{ items: import("./types").WorldInfo[] }>("/worlds"),
  world: (id: string) => request<Record<string, unknown>>(`/worlds/${id}`),
  resolve: (worldId: string, body: unknown) =>
    request<import("./types").SnapshotDoc>(`/worlds/${worldId}/snapshots/resolve`, {
      method: "POST",
      headers: { "Idempotency-Key": newIdempotencyKey() },
      body: JSON.stringify(body),
    }),
  snapshot: (id: string) => request<import("./types").SnapshotDoc>(`/snapshots/${id}`),
  manifest: (snapshotId: string, lod: string, entityId?: string) => {
    const query = new URLSearchParams({ lod });
    if (entityId) query.set("entity_id", entityId);
    return request<import("./types").ManifestDoc>(`/snapshots/${snapshotId}/manifest?${query}`);
  },
  entity: (snapshotId: string, entityId: string) =>
    request<import("./types").EntityDetail>(`/snapshots/${snapshotId}/entities/${entityId}`),
  childrenAll: async (
    snapshotId: string,
    entityId: string,
    cap = 1000,
  ): Promise<import("./types").EntityDetail[]> => {
    const out: import("./types").EntityDetail[] = [];
    let cursor: string | null | undefined;
    do {
      const page = await api.children(snapshotId, entityId, cursor ?? undefined);
      out.push(...page.items);
      cursor = page.next_cursor;
    } while (cursor && out.length < cap);
    return out.slice(0, cap);
  },
  children: (snapshotId: string, entityId: string, cursor?: string) => {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return request<{ items: import("./types").EntityDetail[]; next_cursor: string | null }>(
      `/snapshots/${snapshotId}/entities/${entityId}/children${query}`,
    );
  },
  search: (
    snapshotId: string,
    body: { query: string; scope_entity_id?: string; include_history?: boolean; limit?: number },
  ) =>
    request<{
      items: Array<{
        entity_id: string;
        kind: string;
        semantic_level: string;
        name: string;
        path: string;
        exists_at_snapshot: boolean;
        first_known_appearance?: string;
      }>;
    }>(`/snapshots/${snapshotId}/search`, { method: "POST", body: JSON.stringify(body) }),
  timeline: (worldId: string, versionId: string, scope?: string, bucket = "month") => {
    const query = new URLSearchParams({ world_version_id: versionId, bucket });
    if (scope) query.set("scope_entity_id", scope);
    return request<{
      buckets: Array<{ bucket_start: string; change_count: number; kinds: Record<string, number> }>;
      markers: Array<{ kind: string; repository: string; at: string; clock_adjusted: boolean }>;
      coverage: Array<{ repository: string; oldest_indexed_at: string; newest_indexed_at: string }>;
    }>(`/worlds/${worldId}/timeline?${query}`);
  },
  history: (snapshotId: string, entityId: string) =>
    request<{
      items: Array<{
        operation: string;
        commit_oid: string;
        effective_at: string;
        committed_at: string;
        confidence: string;
      }>;
    }>(`/snapshots/${snapshotId}/entities/${entityId}/history`),
  assetBytes: async (assetId: string): Promise<ArrayBuffer> => {
    const response = await fetch(`${BASE}/assets/${assetId}`);
    if (!response.ok) throw new Error(`Asset failed (${response.status})`);
    return response.arrayBuffer();
  },
  sourcePreview: (snapshotId: string, entityId: string, startLine: number, endLine: number) =>
    request<{
      entity_id: string;
      file_entity_id: string;
      language: string | null;
      text: string;
      truncated: boolean;
    }>(`/snapshots/${snapshotId}/source-preview`, {
      method: "POST",
      body: JSON.stringify({ entity_id: entityId, start_line: startLine, end_line: endLine }),
    }),
};
