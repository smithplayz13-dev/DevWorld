import { motion } from "motion/react";
import { useWorld } from "../state/store";
import type { EntityDetail } from "../api/types";

// Collapsed overview: a compact floating card, not a full-height panel.
// The globe stays dominant until something is selected.
export default function OverviewCard({
  countries,
  precision,
  coverage,
  onSelect,
}: {
  countries: EntityDetail[];
  precision: string;
  coverage: string;
  onSelect: (id: string) => void;
}) {
  const pendingTiles = useWorld((s) => s.pendingTiles);
  const decodedBytes = useWorld((s) => s.decodedBytes);
  const sceneObjects = useWorld((s) => s.sceneObjects);
  const sceneBytes = useWorld((s) => s.sceneBytes);
  const perf = useWorld((s) => s.perf);
  return (
    <motion.div
      className="dw-overview"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
      aria-label="World overview"
    >
      <p className="dw-eyebrow">
        <span className="dw-signal" /> ACCOUNT OBSERVATORY
      </p>
      <h1>
        World atlas<span>.</span>
      </h1>
      <p className="dw-overview-intro">
        Every repository, a country.
        <br />
        Every commit, a moment in time.
      </p>
      <div className="dw-register-heading">
        <span>COUNTRY REGISTER</span>
        <span>{String(countries.length).padStart(2, "0")}</span>
      </div>
      <nav className="dw-country-register" aria-label="Countries">
        {countries.map((country, index) => (
          <button
            key={country.entity_id}
            onClick={() => onSelect(country.entity_id)}
            type="button"
            aria-label={`Explore ${country.name}`}
          >
            <span className="dw-country-index">{String(index + 1).padStart(2, "0")}</span>
            <span className="dw-country-name">
              {country.name}
              <small>
                {country.language ?? "Mixed languages"} · {country.child_count} entries
              </small>
            </span>
            <span className="dw-country-arrow" aria-hidden="true">
              ↗
            </span>
          </button>
        ))}
      </nav>
      <p className="dw-demo-note">
        SYNTHETIC WORLD{" "}
        <span>
          {precision} / {coverage}
        </span>
      </p>
      {pendingTiles > 0 && <p className="dw-muted">Resolving surface detail…</p>}
      <details>
        <summary className="dw-faint" style={{ fontSize: 12 }}>
          Diagnostics (developer)
        </summary>
        <dl className="dw-meta">
          <dt>Tile requests</dt>
          <dd>{pendingTiles}</dd>
          <dt>Tile payloads</dt>
          <dd>{(decodedBytes / 1024).toFixed(1)} KiB</dd>
          <dt>Scene objects</dt>
          <dd>{sceneObjects}</dd>
          <dt>Scene geometry</dt>
          <dd>{(sceneBytes / 1024).toFixed(1)} KiB est.</dd>
          <dt>Frame</dt>
          <dd>{perf ? `${perf.fps} FPS · ${perf.ms} ms` : "warming up"}</dd>
          <dt>Draw</dt>
          <dd>{perf ? `${perf.calls} calls · ${(perf.tris / 1000).toFixed(0)}k tris` : "—"}</dd>
        </dl>
      </details>
    </motion.div>
  );
}
