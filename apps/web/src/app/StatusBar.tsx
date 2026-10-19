import { useWorld } from "../state/store";

// Slim status line: snapshot state in one glance. Developer diagnostics live
// in the inspector overview, not here.
export default function StatusBar({ summary, loading }: { summary: string; loading: boolean }) {
  const lowDetail = useWorld((s) => s.lowDetail);
  const altitude = useWorld((s) => s.altitude);
  const set = useWorld((s) => s.set);
  return (
    <div
      className="dw-faint dw-mono"
      style={{ display: "flex", gap: 16, alignItems: "center", fontSize: 11 }}
    >
      <span>{loading ? "Streaming detail…" : summary}</span>
      {altitude && <span>{altitude}</span>}
      <span style={{ flex: 1 }} />
      <button
        type="button"
        className="dw-btn"
        style={{ height: 26 }}
        onClick={() => set({ lowDetail: !lowDetail })}
        aria-pressed={lowDetail}
        title="Lower-cost visual mode: same navigation, less geometry"
      >
        {lowDetail ? "LOW" : "FULL"}
      </button>
    </div>
  );
}
