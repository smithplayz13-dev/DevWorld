// World page: owns snapshot resolution, selection and time. Zoom never
// resets time; time changes never move the camera. Stale responses are
// ignored by monotonic sequence (ARCHITECTURE.md section 3).
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useSearchParams } from "react-router-dom";
import GlobeView from "../scene/GlobeView";
import { useWorld } from "../state/store";
import { api } from "../api/http";
import type { EntityDetail, Selector, SnapshotDoc } from "../api/types";
import { bootReveal } from "../fx/accents";
import AtlasView from "../atlas/AtlasView";
import Chronoscope, { type ChronoBucket } from "./Chronoscope";
import Inspector, { type RevisionInfo } from "./Inspector";
import OverviewCard from "./OverviewCard";
import SearchPalette from "./SearchPalette";
import StatusBar from "./StatusBar";
import TopBar from "./TopBar";
import Tour from "./Tour";

export default function WorldPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const world = useWorld();
  const shellRef = useRef<HTMLDivElement>(null);
  const revealed = useRef(false);
  const [snapshot, setSnapshot] = useState<SnapshotDoc | null>(null);
  const [countries, setCountries] = useState<EntityDetail[]>([]);
  const [selectionChildren, setSelectionChildren] = useState<EntityDetail[]>([]);
  const [coverage, setCoverage] = useState<
    Array<{ repository: string; oldest_indexed_at: string; newest_indexed_at: string }>
  >([]);
  const [buckets, setBuckets] = useState<ChronoBucket[]>([]);
  const [markers, setMarkers] = useState<Array<{ kind: string; at: string }>>([]);
  const [atlasOpen, setAtlasOpen] = useState(false);
  const [previewEnabled, setPreviewEnabled] = useState(false);
  const [rowVersion, setRowVersion] = useState(1);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const bootstrapped = useRef(false);
  const prevChildrenRef = useRef<Map<string, string | null>>(new Map());
  const prevDiffSelection = useRef<string | null>(null);
  const diffGenRef = useRef(0);
  const [diff, setDiff] = useState<{
    added: string[];
    modified: string[];
    removed: string[];
    gen: number;
  }>({
    added: [],
    modified: [],
    removed: [],
    gen: 0,
  });

  useEffect(() => {
    mounted.current = true;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (event.key === "/") {
        event.preventDefault();
        useWorld.getState().set({ searchOpen: true });
      } else if (event.key === "T") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>(".dw-chronoscope input[type='range']")?.focus();
      } else if (event.key === "Escape") {
        useWorld.getState().set({ searchOpen: false });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      mounted.current = false;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const buildTrail = useCallback(
    async (snapshotId: string, entity: EntityDetail): Promise<EntityDetail[]> => {
      const trail: EntityDetail[] = [entity];
      let cursor: EntityDetail | null = entity;
      for (let i = 0; i < 8 && cursor?.parent_entity_id; i++) {
        try {
          const parent = await api.entity(snapshotId, cursor.parent_entity_id);
          if (parent.kind === "world") break;
          trail.unshift(parent);
          cursor = parent;
        } catch {
          break;
        }
      }
      return trail;
    },
    [],
  );

  const select = useCallback(
    async (entityId: string, doc?: SnapshotDoc, fly = true) => {
      const active = doc ?? snapshot;
      if (!active) return;
      // Fly first: the camera starts moving while data loads (prefetch
      // during approach); time and selection resolve without moving it.
      if (fly) useWorld.getState().flyTo(entityId);
      try {
        const entity = await api.entity(active.snapshot_id, entityId);
        if (!mounted.current) return;
        const trail = await buildTrail(active.snapshot_id, entity);
        const state = useWorld.getState();
        setSelectionChildren([]);
        state.set({ selection: entity, breadcrumbs: trail, inspectorOpen: true });
        const kids = await api.childrenAll(active.snapshot_id, entityId, 500);
        if (!mounted.current) return;
        setSelectionChildren(kids);
        // History diff from entity versions: added/removed/modified flashes.
        if (prevDiffSelection.current === entityId) {
          const prev = prevChildrenRef.current;
          const next = new Map(kids.map((k) => [k.entity_id, k.version_id ?? null]));
          const added = [...next.keys()].filter((id) => !prev.has(id));
          const removed = [...prev.keys()].filter((id) => !next.has(id));
          const modified = [...next.keys()].filter(
            (id) => prev.has(id) && prev.get(id) !== next.get(id),
          );
          diffGenRef.current += 1;
          setDiff({ added, modified, removed, gen: diffGenRef.current });
          prevChildrenRef.current = next;
        } else {
          prevDiffSelection.current = entityId;
          prevChildrenRef.current = new Map(kids.map((k) => [k.entity_id, k.version_id ?? null]));
          setDiff({ added: [], modified: [], removed: [], gen: diffGenRef.current });
        }
        state.announce(`${entity.semantic_level} ${entity.name} selected.`);
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.set("s", active.snapshot_id);
          next.set("e", entityId);
          return next;
        });
        if (!entity.exists_at_snapshot && entity.nearest_existing_ancestor_id) {
          state.announce("Absent at this time. Showing nearest existing ancestor.");
        }
      } catch {
        setError("That entity is not available in this snapshot.");
      }
    },
    [snapshot, buildTrail, setSearchParams],
  );

  const applySnapshot = useCallback(
    async (doc: SnapshotDoc, sequence: number, entityId: string | null) => {
      setSnapshot(doc);
      useWorld.getState().set({ snapshotId: doc.snapshot_id, scopeEntityId: doc.scope_entity_id });
      const kids = await api.children(doc.snapshot_id, doc.scope_entity_id);
      if (sequence !== useWorld.getState().timeline.sequence || !mounted.current) return;
      setCountries(kids.items.filter((item) => item.kind === "repository"));
      const timeline = await api.timeline(doc.world_id, doc.world_version_id);
      if (!mounted.current) return;
      setCoverage(timeline.coverage);
      setBuckets(
        timeline.buckets.map((b) => ({
          bucket_start: b.bucket_start,
          change_count: b.change_count,
        })),
      );
      setMarkers(timeline.markers.map((m) => ({ kind: m.kind, at: m.at })));
      if (shellRef.current && !revealed.current) {
        revealed.current = true;
        bootReveal(shellRef.current);
      }
      if (entityId) {
        await select(entityId, doc, false);
      }
    },
    [select],
  );

  const resolve = useCallback(
    async (selector: Selector, precision: "exact" | "preview") => {
      const state = useWorld.getState();
      if (!state.worldId || !state.versionId) return;
      const sequence = state.bumpSequence();
      const scope = state.timeline.scopePinned
        ? undefined
        : (state.selection?.entity_id ?? undefined);
      try {
        const doc = await api.resolve(state.worldId, {
          world_version_id: state.versionId,
          scope_entity_id: scope,
          selector,
          precision,
        });
        if (sequence !== useWorld.getState().timeline.sequence || !mounted.current) return;
        useWorld.getState().set({
          timeline: { ...useWorld.getState().timeline, selector, precision },
        });
        await applySnapshot(doc, sequence, state.selection?.entity_id ?? null);
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.set("s", doc.snapshot_id);
          return next;
        });
      } catch {
        setError("Time resolution failed for this snapshot.");
      }
    },
    [applySnapshot, setSearchParams],
  );

  const loadSnapshot = useCallback(
    async (snapshotId: string, entityId: string | null) => {
      const sequence = useWorld.getState().bumpSequence();
      try {
        const doc = await api.snapshot(snapshotId);
        if (sequence !== useWorld.getState().timeline.sequence || !mounted.current) return;
        await applySnapshot(doc, sequence, entityId);
        if (entityId && sequence === useWorld.getState().timeline.sequence) {
          useWorld.getState().flyTo(entityId);
        }
      } catch {
        setError("That snapshot link is no longer valid; resolved latest instead.");
        await resolve({ type: "latest" }, "exact");
      }
    },
    [applySnapshot, resolve],
  );

  // Bootstrap: session, world, initial snapshot or deep link (once).
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    (async () => {
      try {
        const session = await api.session();
        if (session.csrf_token) sessionStorage.setItem("dw-csrf", session.csrf_token);
        const worlds = await api.worlds();
        const first = worlds.items[0];
        if (!first || !first.active_version_id) {
          setError("No world available. The demo seed may not have loaded.");
          return;
        }
        const detail = (await api.world(first.id)) as {
          source_preview_enabled: boolean;
          row_version?: number;
        };
        if (!mounted.current) return;
        useWorld.getState().set({ worldId: first.id, versionId: first.active_version_id });
        setPreviewEnabled(Boolean(detail.source_preview_enabled));
        setRowVersion(Number(detail.row_version ?? 1));
        const snapshotParam = searchParams.get("s");
        if (snapshotParam) {
          await loadSnapshot(snapshotParam, searchParams.get("e"));
        } else {
          await resolve({ type: "latest" }, "exact");
        }
      } catch {
        setError("Could not reach the API. Start the backend on 127.0.0.1:8000.");
      }
    })();
  }, [loadSnapshot, resolve, searchParams]);

  const ascend = (entityId: string | null) => {
    const state = useWorld.getState();
    if (entityId === null) {
      state.set({ selection: null, breadcrumbs: [] });
      setSelectionChildren([]);
      state.flyTo(null);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("e");
        return next;
      });
      state.announce("Overview. Back in orbit.");
    } else {
      void select(entityId);
    }
  };

  const togglePreview = async (enabled: boolean) => {
    const state = useWorld.getState();
    if (!state.worldId) return;
    try {
      const response = await fetch(`/api/v1/worlds/${state.worldId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "If-Match": `"${rowVersion}"` },
        body: JSON.stringify({ source_preview_enabled: enabled }),
      });
      if (!response.ok) throw new Error("settings rejected");
      const body = await response.json();
      setRowVersion(Number(body.row_version ?? rowVersion + 1));
      setPreviewEnabled(enabled);
    } catch {
      setError("Preview setting needs a fresh world state; reload first.");
    }
  };

  const showAtlas = atlasOpen || world.webglFailed;
  const revision: RevisionInfo | null = (() => {
    if (!world.selection || !snapshot) return null;
    const entry = snapshot.repositories.find(
      (r) => r.repository_id === world.selection?.repository_id,
    );
    return {
      commitOid: entry?.resolved_commit_oid ?? null,
      status: entry?.status ?? "unknown",
      at: world.timeline.selector.type === "time" ? (world.timeline.selector.at ?? null) : null,
    };
  })();
  const statusSummary = snapshot
    ? `${snapshot.precision === "preview" ? "Preview" : "Exact"} · ${snapshot.coverage} · ${snapshot.repositories.filter((r) => r.status === "resolved").length}/${snapshot.repositories.length} countries resolved`
    : "Resolving…";

  return (
    <div className="dw-shell" ref={shellRef}>
      <TopBar worldName="Demo World" trail={world.breadcrumbs} onAscend={ascend} />
      {error && (
        <p role="alert" className="dw-amber" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      <div className="dw-main">
        <div className="dw-rail" aria-label="Instruments" data-reveal>
          <button
            type="button"
            className={`dw-btn${showAtlas ? " active" : ""}`}
            onClick={() => setAtlasOpen(!atlasOpen)}
            aria-pressed={showAtlas}
            title="DOM atlas (keyboard navigation)"
          >
            ⌕
          </button>
          <button
            type="button"
            className="dw-btn"
            onClick={() => ascend(null)}
            title="Overview (orbit)"
          >
            ◉
          </button>
          <button
            type="button"
            className="dw-btn"
            onClick={() => world.selection && ascend(world.selection.parent_entity_id)}
            title="Ascend one level"
          >
            ▲
          </button>
        </div>
        {showAtlas ? (
          <div style={{ overflowY: "auto", padding: 4 }}>
            <AtlasView
              key={snapshot?.snapshot_id ?? "empty"}
              snapshotId={snapshot?.snapshot_id ?? ""}
              roots={countries}
              onSelect={(id) => void select(id)}
            />
          </div>
        ) : snapshot ? (
          <GlobeView
            snapshotId={snapshot.snapshot_id}
            countries={countries}
            selection={world.selection}
            childrenOfSelection={selectionChildren}
            trail={world.breadcrumbs}
            diff={diff}
            inspectorOpen={world.inspectorOpen && world.selection !== null}
            onSelect={(id) => void select(id)}
          />
        ) : (
          <div style={{ padding: 32 }}>
            <p className="dw-muted">Indexing demo world… country regions appear first.</p>
          </div>
        )}
        <AnimatePresence initial={false}>
          {world.inspectorOpen && !showAtlas && snapshot && world.selection && (
            <motion.div
              key="inspector"
              layout
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
              style={{ minHeight: 0, display: "flex" }}
            >
              <Inspector
                snapshotId={snapshot.snapshot_id}
                selection={world.selection}
                children={selectionChildren}
                revision={revision}
                onSelect={(id) => void select(id)}
                onAscend={() => world.selection && ascend(world.selection.parent_entity_id)}
                onClose={() => world.set({ inspectorOpen: false })}
                previewEnabled={previewEnabled}
                onTogglePreview={(enabled) => void togglePreview(enabled)}
              />
            </motion.div>
          )}
          {!showAtlas && snapshot && !world.selection && (
            <OverviewCard
              key="overview"
              countries={countries}
              precision={snapshot.precision}
              coverage={snapshot.coverage}
              onSelect={(id) => void select(id)}
            />
          )}
        </AnimatePresence>
        <SearchPalette
          snapshotId={snapshot?.snapshot_id ?? ""}
          scopeEntityId={world.selection?.entity_id}
          open={world.searchOpen && snapshot !== null}
          onSelect={(id) => void select(id)}
          onClose={() => world.set({ searchOpen: false })}
        />
        <Tour open={world.showTour} onDone={() => world.set({ showTour: false })} />
      </div>
      <div>
        <StatusBar summary={statusSummary} loading={world.pendingTiles > 0} />
        <Chronoscope
          snapshot={snapshot}
          buckets={buckets}
          coverage={coverage}
          markers={markers}
          onResolve={(selector, precision) => void resolve(selector, precision)}
        />
      </div>
      <div className="dw-live-region" role="status" aria-live="polite">
        {world.announcement}
      </div>
    </div>
  );
}
