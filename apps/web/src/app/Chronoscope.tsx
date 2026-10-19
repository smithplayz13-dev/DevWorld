// Chronoscope — the persistent time machine (DESIGN.md section 7).
// A precision instrument, not a form slider: the track is a small data
// visualization (bucket bars, event markers, coverage reference band and an
// amber projection playhead). One transparent range input owns all pointer,
// touch and keyboard interaction; the SVG is purely visual. Drag coalesces
// previews; release resolves exact time; stale responses are ignored.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Selector, SnapshotDoc } from "../api/types";
import { useWorld } from "../state/store";
import { createResolution, requestExact, shouldPreview } from "../timeline/resolution";
import { playheadPulse } from "../fx/accents";

export interface ChronoBucket {
  bucket_start: string;
  change_count: number;
}

export interface ChronoMarker {
  kind: string;
  at: string;
}

export default function Chronoscope({
  snapshot,
  buckets,
  coverage,
  markers,
  onResolve,
}: {
  snapshot: SnapshotDoc | null;
  buckets: ChronoBucket[];
  coverage: Array<{ repository: string; oldest_indexed_at: string }>;
  markers: ChronoMarker[];
  onResolve: (selector: Selector, precision: "exact" | "preview") => void;
}) {
  const timeline = useWorld((s) => s.timeline);
  const set = useWorld((s) => s.set);
  const announce = useWorld((s) => s.announce);
  const controller = useRef(createResolution());
  const handleRef = useRef<HTMLDivElement>(null);
  const [slider, setSlider] = useState(100);
  const [playing, setPlaying] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [dateValue, setDateValue] = useState("");

  const markerAt = useCallback(
    (position: number): string | null => {
      if (markers.length === 0) return null;
      const index = Math.min(markers.length - 1, Math.floor((position / 100) * markers.length));
      return markers[index].at;
    },
    [markers],
  );

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setSlider((value) => {
        const next = value >= 100 ? 0 : value + 25;
        const at = markerAt(next);
        if (at) onResolve({ type: "time", at }, "exact");
        return next;
      });
    }, 1400);
    return () => window.clearInterval(timer);
  }, [playing, onResolve, markerAt]);

  useEffect(() => {
    if (snapshot?.precision === "exact" && handleRef.current) playheadPulse(handleRef.current);
  }, [snapshot?.snapshot_id, snapshot?.precision]);

  const scrub = (position: number) => {
    setSlider(position);
    if (shouldPreview(controller.current, Date.now())) {
      const at = markerAt(position);
      if (at) onResolve({ type: "time", at }, "preview");
    }
  };

  const release = () => {
    requestExact(controller.current);
    const at = markerAt(slider);
    if (at) {
      onResolve({ type: "time", at }, "exact");
      announce(`Resolved exact state at ${at.slice(0, 10)}`);
    }
  };

  const step = (direction: 1 | -1) => {
    const next = Math.min(100, Math.max(0, slider + direction * 25));
    setSlider(next);
    const at = markerAt(next);
    if (at) onResolve({ type: "time", at }, "exact");
  };

  const maxCount = Math.max(1, ...buckets.map((b) => b.change_count));
  const selectedDate =
    timeline.selector.type === "time" ? timeline.selector.at?.slice(0, 10) : null;
  const valueText = selectedDate ?? "Now (latest indexed state)";

  return (
    <section className="dw-chronoscope" aria-label="Chronoscope. Explore code history." data-reveal>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong
          className="dw-amber"
          style={{ fontFamily: "var(--dw-font-display)", letterSpacing: "0.14em" }}
        >
          CHRONOSCOPE
        </strong>
        <span
          className={`dw-badge ${snapshot?.precision === "preview" ? "amber" : "cyan"}`}
          title={
            snapshot?.precision === "preview"
              ? "Preview: a nearby precomputed state while dragging. Release for the exact commit."
              : "Exact: the resolved tree equals its selected commit. Older history may still be partial."
          }
        >
          {snapshot?.precision === "preview" ? "PREVIEW" : "EXACT"}
        </span>
        <span
          className="dw-badge"
          title={
            snapshot?.coverage === "complete"
              ? "Complete within included repositories and analysis policy."
              : "Partial: truncated trees, shallow history or excluded files. Missing past is unknown, not empty."
          }
        >
          {snapshot?.coverage === "complete" ? "COMPLETE" : "PARTIAL"}
        </span>
        <span className="dw-faint" style={{ fontSize: 12 }}>
          Scope {timeline.scopePinned ? "· World (pinned)" : "· follows selection"}
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="dw-btn"
          onClick={() => step(-1)}
          aria-label="Previous change"
        >
          ◀
        </button>
        <button
          type="button"
          className="dw-btn"
          onClick={() => setPlaying(!playing)}
          aria-pressed={playing}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <button type="button" className="dw-btn" onClick={() => step(1)} aria-label="Next change">
          ▶|
        </button>
        <button
          type="button"
          className="dw-btn amber"
          onClick={() => {
            setSlider(100);
            onResolve({ type: "latest" }, "exact");
          }}
        >
          Now
        </button>
        <button
          type="button"
          className="dw-btn"
          onClick={() => set({ timeline: { ...timeline, scopePinned: !timeline.scopePinned } })}
          aria-pressed={timeline.scopePinned}
          title="Pin the timeline to the whole world or follow the selection"
        >
          {timeline.scopePinned ? "World" : "Selection"}
        </button>
        <div style={{ position: "relative" }}>
          <button
            type="button"
            className="dw-btn dw-mono"
            onClick={() => setDateOpen(!dateOpen)}
            aria-expanded={dateOpen}
          >
            {valueText} ▾
          </button>
          {dateOpen && (
            <div
              className="dw-sheet"
              style={{
                position: "absolute",
                right: 0,
                bottom: 40,
                padding: 12,
                zIndex: 20,
                display: "grid",
                gap: 8,
              }}
            >
              <label className="dw-muted" style={{ fontSize: 12 }}>
                Jump to date
                <input
                  type="date"
                  value={dateValue}
                  min="2026-01-01"
                  max="2026-12-31"
                  onChange={(event) => setDateValue(event.target.value)}
                  style={{
                    display: "block",
                    marginTop: 4,
                    background: "var(--dw-surface-sunken)",
                    border: "var(--dw-border)",
                    borderRadius: 3,
                    padding: 6,
                  }}
                />
              </label>
              <button
                type="button"
                className="dw-btn amber"
                onClick={() => {
                  if (dateValue) onResolve({ type: "time", at: `${dateValue}T12:00:00Z` }, "exact");
                  setDateOpen(false);
                }}
              >
                Resolve exact state
              </button>
            </div>
          )}
        </div>
      </div>
      <div style={{ position: "relative", height: 34, marginTop: 6 }}>
        <svg
          viewBox="0 0 100 34"
          preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
          aria-hidden="true"
        >
          {/* indexed-coverage reference band */}
          <rect x="0" y="20" width="100" height="6" fill="#ffc16a" opacity="0.12" />
          {/* change-count bars */}
          {buckets.map((bucket, i) => {
            const width = 100 / Math.max(1, buckets.length);
            const height = Math.max(1.5, (bucket.change_count / maxCount) * 16);
            return (
              <rect
                key={bucket.bucket_start}
                x={i * width + 0.4}
                y={20 - height}
                width={Math.max(0.6, width - 0.8)}
                height={height}
                fill="#2c6a84"
              />
            );
          })}
          {/* event markers */}
          {markers.map((marker) => (
            <g key={marker.at}>
              <title>{`${marker.kind} · ${marker.at.slice(0, 10)}`}</title>
              <rect
                x={xForMarker(marker.at, markers) - 0.5}
                y={24}
                width={1}
                height={4}
                transform={`rotate(45 ${xForMarker(marker.at, markers)} 26)`}
                fill="#ffc16a"
              />
            </g>
          ))}
          {/* base track */}
          <rect x="0" y="27.5" width="100" height="1" fill="#246075" />
          {/* projection playhead */}
          <rect x={slider - 0.25} y="2" width="0.5" height="26" fill="#ffc16a" />
        </svg>
        <div
          ref={handleRef}
          style={{
            position: "absolute",
            left: `${slider}%`,
            top: 0,
            width: 14,
            height: 14,
            transform: "translateX(-50%) rotate(45deg)",
            background: "var(--dw-amber)",
            border: "2px solid #0a141d",
          }}
        />
        <input
          type="range"
          min={0}
          max={100}
          value={slider}
          onChange={(event) => scrub(Number(event.target.value))}
          onPointerUp={release}
          onKeyUp={release}
          aria-label="History scrubber"
          aria-valuetext={valueText}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            opacity: 0,
            cursor: "ew-resize",
            height: 34,
          }}
        />
      </div>
      <div
        style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}
        className="dw-faint dw-mono"
      >
        <span>{buckets[0]?.bucket_start.slice(0, 7) ?? "—"}</span>
        <span>
          {coverage.length > 0
            ? `History from ${coverage[0].oldest_indexed_at.slice(0, 10)} · earlier time is unknown, not empty`
            : "Loading coverage…"}
        </span>
        <span>now</span>
      </div>
    </section>
  );
}

function xForMarker(at: string, markers: ChronoMarker[]): number {
  if (markers.length < 2) return 50;
  const times = markers.map((m) => Date.parse(m.at));
  const min = Math.min(...times);
  const max = Math.max(...times);
  if (max <= min) return 50;
  return ((Date.parse(at) - min) / (max - min)) * 100;
}
