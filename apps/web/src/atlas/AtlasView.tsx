// Accessible DOM atlas (DESIGN.md section 10). A complete alternate
// experience: Up/Down move, Right expands, Left collapses or focuses the
// parent, Enter flies. A 3D pick selects the same entity ID as its DOM entry.
import { useEffect, useState } from "react";
import { api } from "../api/http";
import type { EntityDetail } from "../api/types";

interface Node extends EntityDetail {
  children?: Node[];
  expanded?: boolean;
  cursor?: string | null;
}

export default function AtlasView({
  snapshotId,
  roots,
  onSelect,
}: {
  snapshotId: string;
  roots: EntityDetail[];
  onSelect: (entityId: string) => void;
}) {
  // Remounted per snapshot by the parent (key={snapshotId}), so props are
  // the initial state — no effect sync needed.
  const [tree, setTree] = useState<Node[]>(() => roots.map((r) => ({ ...r })));
  const [focusId, setFocusId] = useState<string | null>(() => roots[0]?.entity_id ?? null);

  const flat = flatten(tree);

  const toggle = async (node: Node) => {
    if (node.expanded) {
      setTree((prev) => update(prev, node.entity_id, { expanded: false }));
      return;
    }
    if (!node.children) {
      const response = await api.children(snapshotId, node.entity_id);
      setTree((prev) =>
        update(prev, node.entity_id, {
          expanded: true,
          children: response.items,
          cursor: response.next_cursor,
        }),
      );
    } else {
      setTree((prev) => update(prev, node.entity_id, { expanded: true }));
    }
  };

  const loadMore = async (node: Node) => {
    if (!node.cursor) return;
    const response = await api.children(snapshotId, node.entity_id, node.cursor);
    setTree((prev) =>
      update(prev, node.entity_id, {
        children: [...(node.children ?? []), ...response.items],
        cursor: response.next_cursor,
      }),
    );
  };

  const onKey = (event: React.KeyboardEvent, node: Node, index: number) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = flat[index + 1];
      if (next) setFocusId(next.entity_id);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const prev = flat[index - 1];
      if (prev) setFocusId(prev.entity_id);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      void toggle(node);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (node.expanded) {
        setTree((prev) => update(prev, node.entity_id, { expanded: false }));
      } else if (node.parent_entity_id) {
        setFocusId(node.parent_entity_id);
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      onSelect(node.entity_id);
    }
  };

  useEffect(() => {
    if (focusId) document.getElementById(`atlas-${focusId}`)?.focus();
  }, [focusId]);

  return (
    <nav aria-label="World atlas tree">
      <ul role="tree">
        {flat.map((node, index) => (
          <li key={node.entity_id} role="none" style={{ paddingLeft: node.depth * 16 }}>
            <button
              type="button"
              role="treeitem"
              id={`atlas-${node.entity_id}`}
              aria-expanded={node.child_count > 0 ? Boolean(node.expanded) : undefined}
              aria-label={`${node.semantic_level} ${node.name}`}
              tabIndex={node.entity_id === focusId ? 0 : -1}
              onClick={() => {
                setFocusId(node.entity_id);
                onSelect(node.entity_id);
              }}
              onKeyDown={(event) => onKey(event, node, index)}
              onDoubleClick={() => void toggle(node)}
            >
              {node.child_count > 0 ? (node.expanded ? "▾ " : "▸ ") : "· "}
              {node.name}
            </button>
            {node.expanded && node.cursor && (
              <button
                type="button"
                className="dw-btn"
                style={{ marginLeft: 24 }}
                onClick={() => void loadMore(node)}
              >
                Load more
              </button>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

function flatten(tree: Node[], depth = 0): Array<Node & { depth: number }> {
  const out: Array<Node & { depth: number }> = [];
  for (const node of tree) {
    out.push({ ...node, depth });
    if (node.expanded && node.children) out.push(...flatten(node.children, depth + 1));
  }
  return out;
}

function update(tree: Node[], id: string, patch: Partial<Node>): Node[] {
  return tree.map((node) => {
    if (node.entity_id === id) return { ...node, ...patch };
    if (node.children) return { ...node, children: update(node.children, id, patch) };
    return node;
  });
}
