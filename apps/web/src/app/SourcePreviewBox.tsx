import { useState } from "react";
import { api } from "../api/http";

/** Bounded owner-only source preview. Keyed by entity+snapshot so a time or
 *  selection change always starts from an unloaded state. */
export default function SourcePreviewBox({
  snapshotId,
  entityId,
}: {
  snapshotId: string;
  entityId: string;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const loadPreview = async () => {
    try {
      const result = await api.sourcePreview(snapshotId, entityId, 1, 60);
      setPreview(result.text);
    } catch {
      setPreview("Preview unavailable for this entity.");
    }
  };
  return (
    <div>
      <button type="button" className="dw-btn" onClick={loadPreview}>
        Load bounded preview
      </button>
      {preview && (
        <pre className="dw-mono" style={{ whiteSpace: "pre-wrap" }}>
          {preview}
        </pre>
      )}
    </div>
  );
}
