import { useEffect, useRef } from "react";
import type { EntityDetail } from "../api/types";
import { WORLD_TYPE_LABEL } from "../api/types";
import { inspectorFlash } from "../fx/accents";
import SourcePreviewBox from "./SourcePreviewBox";

export interface RevisionInfo {
  commitOid: string | null;
  status: string;
  at: string | null;
}

export default function Inspector({
  snapshotId,
  selection,
  children,
  revision,
  onSelect,
  onAscend,
  onClose,
  previewEnabled,
  onTogglePreview,
}: {
  snapshotId: string;
  selection: EntityDetail;
  children: EntityDetail[];
  revision: RevisionInfo | null;
  onSelect: (entityId: string) => void;
  onAscend: () => void;
  onClose: () => void;
  previewEnabled: boolean;
  onTogglePreview: (enabled: boolean) => void;
}) {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (panelRef.current) {
      panelRef.current.scrollTop = 0;
      inspectorFlash(panelRef.current);
    }
  }, [selection.entity_id, snapshotId]);

  return (
    <aside ref={panelRef} className="dw-inspector" aria-label="Inspector">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <p className="dw-muted" style={{ margin: 0, flex: 1 }}>
          {WORLD_TYPE_LABEL[selection.kind] ?? selection.kind}
        </p>
        <button type="button" className="dw-btn" onClick={onClose} aria-label="Collapse inspector">
          ✕
        </button>
      </div>
      <h2>{selection.name}</h2>
      <p className="dw-mono dw-muted" style={{ overflowWrap: "anywhere" }}>
        {selection.path}
      </p>
      {!selection.exists_at_snapshot && (
        <p className="dw-amber">Absent at this time — nearest ancestor shown below.</p>
      )}
      <dl className="dw-meta">
        <dt>Historical time</dt>
        <dd>{revision?.at ? revision.at.slice(0, 10) : "now"}</dd>
        <dt>Revision</dt>
        <dd>{revision?.commitOid ? revision.commitOid.slice(0, 7) : (revision?.status ?? "—")}</dd>
        <dt>Language</dt>
        <dd>{selection.language ?? "—"}</dd>
        <dt>Bytes</dt>
        <dd>{selection.metrics.source_bytes ?? "—"}</dd>
        <dt>Lines</dt>
        <dd>{selection.metrics.source_lines ?? "—"}</dd>
        <dt>Analysis</dt>
        <dd>{selection.analysis_status}</dd>
        <dt>Children</dt>
        <dd>{selection.child_count}</dd>
      </dl>
      {selection.analysis_status !== "ready" && (
        <p className="dw-muted">
          Outline unavailable ({selection.analysis_status}
          {selection.exclusion_reason ? `: ${selection.exclusion_reason}` : ""}). File-level
          navigation still works.
        </p>
      )}
      <p className="dw-faint" style={{ fontSize: 12 }}>
        Footprint encodes clamped source bytes, height encodes clamped lines — never a quality
        score.
        {selection.kind === "repository" &&
          " Country area encodes clamped logarithmic source bytes; coastline relief is procedural dressing."}
      </p>
      <div style={{ display: "flex", gap: 8, margin: "8px 0" }}>
        <button type="button" className="dw-btn" onClick={onAscend}>
          ▲ Ascend
        </button>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}>
          <input
            type="checkbox"
            checked={previewEnabled}
            onChange={(event) => onTogglePreview(event.target.checked)}
          />
          Owner preview
        </label>
      </div>
      {previewEnabled ? (
        <SourcePreviewBox
          key={`${selection.entity_id}@${snapshotId}`}
          snapshotId={snapshotId}
          entityId={selection.entity_id}
        />
      ) : (
        <p className="dw-faint" style={{ fontSize: 12 }}>
          Source preview is off by default and owner-only.
        </p>
      )}
      {children.length > 0 && (
        <div>
          <h3>Contains</h3>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
            {children.slice(0, 120).map((child) => (
              <li key={child.entity_id}>
                <button
                  type="button"
                  className="dw-btn"
                  style={{ width: "100%", justifyContent: "flex-start" }}
                  onClick={() => onSelect(child.entity_id)}
                >
                  {child.name} <span className="dw-faint">· {child.semantic_level}</span>
                </button>
              </li>
            ))}
          </ul>
          {children.length > 120 && (
            <p className="dw-faint" style={{ fontSize: 12 }}>
              +{children.length - 120} more — refine with search or the atlas.
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
