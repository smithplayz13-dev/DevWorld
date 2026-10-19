import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api } from "../api/http";

export default function SearchPalette({
  snapshotId,
  scopeEntityId,
  open,
  onSelect,
  onClose,
}: {
  snapshotId: string;
  scopeEntityId?: string;
  open: boolean;
  onSelect: (entityId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    Array<{
      entity_id: string;
      name: string;
      path: string;
      exists_at_snapshot: boolean;
      first_known_appearance?: string;
    }>
  >([]);
  const [error, setError] = useState("");

  const run = async (value: string) => {
    setQuery(value);
    if (value.trim().length === 0) {
      setResults([]);
      return;
    }
    try {
      const response = await api.search(snapshotId, {
        query: value,
        scope_entity_id: scopeEntityId,
        include_history: true,
        limit: 20,
      });
      setResults(response.items);
      setError("");
    } catch {
      setError("Search failed for this snapshot.");
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-label="Search"
          className="dw-sheet"
          initial={{ opacity: 0, y: -8, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.99 }}
          transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            zIndex: 10,
            width: "min(380px, 92vw)",
            padding: 12,
          }}
        >
          <input
            autoFocus
            type="search"
            value={query}
            onChange={(event) => void run(event.target.value)}
            placeholder="Search repositories, paths, symbols"
            aria-label="Search current snapshot"
            style={{
              width: "100%",
              background: "var(--dw-surface-sunken)",
              border: "var(--dw-border)",
              borderRadius: 3,
              padding: "8px 10px",
            }}
          />
          {error && <p className="dw-amber">{error}</p>}
          {query.trim() !== "" && (
            <p className="dw-faint" style={{ fontSize: 12 }}>
              {results.length} result{results.length === 1 ? "" : "s"} · time preserved on jump
            </p>
          )}
          <ul
            style={{
              listStyle: "none",
              margin: "8px 0",
              padding: 0,
              display: "grid",
              gap: 2,
              maxHeight: "46dvh",
              overflowY: "auto",
            }}
          >
            {results.map((hit) => (
              <li key={hit.entity_id}>
                <button
                  type="button"
                  className="dw-btn"
                  style={{
                    width: "100%",
                    justifyContent: "flex-start",
                    height: "auto",
                    padding: "6px 8px",
                  }}
                  onClick={() => {
                    onSelect(hit.entity_id);
                    onClose();
                  }}
                >
                  <span>
                    {hit.name} <span className="dw-faint">· {hit.path}</span>
                    {!hit.exists_at_snapshot && hit.first_known_appearance && (
                      <span className="dw-amber">
                        {" "}
                        · first {hit.first_known_appearance.slice(0, 10)}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="dw-btn" onClick={onClose}>
            Close (Esc)
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
