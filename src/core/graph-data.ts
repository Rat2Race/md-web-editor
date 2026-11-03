import { indexDocument, resolveLink } from "../editor/markdown";
import type { GraphData, GraphEdge, GraphNode, Note, VaultEntry } from "./types";
export function buildGraph(notes: readonly Note[], entries: readonly VaultEntry[]): GraphData {
  const paths = entries.map((e) => e.path);
  const byPath = new Map(entries.map((e) => [e.path, e]));
  const indexes = notes.map((note) => indexDocument(note.content));
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  for (const [i, note] of notes.entries()) {
    nodes.set(note.path, {
      id: note.path,
      label: note.path.replace(/^.*\//, "").replace(/\.markdown$|\.md$/i, ""),
      kind: "note",
      tags: indexes[i]?.tags ?? [],
      modified: byPath.get(note.path)?.modified ?? 0,
    });
  }
  for (const [i, note] of notes.entries()) {
    const index = indexes[i];
    if (!index) continue;
    const linked = new Set<string>();
    for (const link of index.links) {
      const resolved = resolveLink(note.path, link.target, paths, link.kind);
      if (resolved.kind === "ambiguous") {
        const id = `?${JSON.stringify([note.path, link.target])}`;
        nodes.set(id, {
          id,
          label: `${link.label || link.target} (?)`,
          kind: "missing",
          tags: [],
          modified: 0,
          candidates: resolved.paths,
        });
        if (!linked.has(id)) edges.push({ source: note.path, target: id });
        linked.add(id);
        continue;
      }
      if (resolved.kind !== "note" && resolved.kind !== "missing") continue;
      const path = resolved.path;
      const entry = byPath.get(path);
      if (!nodes.has(path))
        nodes.set(path, {
          id: path,
          label: path.replace(/^.*\//, ""),
          kind: entry?.kind === "asset" ? "asset" : "missing",
          tags: [],
          modified: entry?.modified ?? 0,
        });
      if (path !== note.path && !linked.has(path)) edges.push({ source: note.path, target: path });
      linked.add(path);
    }
    for (const tag of index.tags) {
      const id = `#${tag.replace(/^#/, "")}`;
      nodes.set(id, { id, label: id, kind: "tag", tags: [tag], modified: 0 });
      edges.push({ source: note.path, target: id });
    }
  }
  return { nodes: [...nodes.values()], edges };
}
