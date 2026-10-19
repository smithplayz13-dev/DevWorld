import { useWorld } from "../state/store";
import type { EntityDetail } from "../api/types";
import { WORLD_TYPE_LABEL } from "../api/types";

export default function TopBar({
  worldName,
  trail,
  onAscend,
}: {
  worldName: string;
  trail: EntityDetail[];
  onAscend: (entityId: string | null) => void;
}) {
  const set = useWorld((s) => s.set);
  const searchOpen = useWorld((s) => s.searchOpen);
  const inspectorOpen = useWorld((s) => s.inspectorOpen);
  const reducedMotion = useWorld((s) => s.reducedMotion);
  return (
    <header className="dw-topbar" data-reveal>
      <span className="dw-wordmark">
        <svg className="dw-logo" viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="16" cy="16" r="12" />
          <ellipse cx="16" cy="16" rx="5" ry="12" />
          <path d="M4 16h24M6 9h20M6 23h20" />
        </svg>
        DEVWORLD<small>CODE · SPACE · TIME</small>
      </span>
      <span className="dw-faint" aria-label="Current world">
        {worldName}
      </span>
      <nav className="dw-breadcrumbs" aria-label="Breadcrumb" style={{ flex: 1 }}>
        <button
          type="button"
          className="dw-btn"
          onClick={() => onAscend(null)}
          title="World · GitHub account"
        >
          ◉
        </button>
        {trail
          .filter((entity) => entity.parent_entity_id !== null)
          .map((entity) => (
            <span key={entity.entity_id} style={{ display: "inline-flex", alignItems: "center" }}>
              <span className="dw-faint" aria-hidden="true">
                {" / "}
              </span>
              <button
                type="button"
                className="dw-btn"
                onClick={() => onAscend(entity.entity_id)}
                title={WORLD_TYPE_LABEL[entity.kind] ?? entity.kind}
              >
                {entity.name}
              </button>
            </span>
          ))}
      </nav>
      <button
        type="button"
        className="dw-btn"
        onClick={() => set({ searchOpen: !searchOpen })}
        aria-expanded={searchOpen}
        aria-label="Search world"
      >
        ⌕ <span className="dw-search-caption">Search world</span>
        <kbd>/</kbd>
      </button>
      <button
        type="button"
        className="dw-btn"
        onClick={() => set({ inspectorOpen: !inspectorOpen })}
        aria-expanded={inspectorOpen}
        aria-pressed={inspectorOpen}
        aria-label="Toggle inspector"
      >
        ▤
      </button>
      <button
        type="button"
        className="dw-btn"
        onClick={() => set({ reducedMotion: !reducedMotion })}
        aria-pressed={reducedMotion}
        title="Reduced motion"
      >
        {reducedMotion ? "◐" : "◑"}
      </button>
    </header>
  );
}
