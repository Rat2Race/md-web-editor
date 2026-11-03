import { describe, expect, it } from "vitest";
import { buildGraph } from "../src/core/graph-data";
import type { Note, VaultEntry } from "../src/core/types";

describe("graph link resolution", () => {
  it("keeps missing paths canonical relative to their source", () => {
    const notes: Note[] = [{ path: "folder/source.md", content: "[[missing]]" }];
    const entries: VaultEntry[] = [{ path: notes[0]?.path ?? "", kind: "note", modified: 1 }];
    const graph = buildGraph(notes, entries);
    expect(graph.nodes.find((node) => node.kind === "missing")?.id).toBe("folder/missing.md");
    expect(graph.edges).toEqual([{ source: "folder/source.md", target: "folder/missing.md" }]);
  });
  it("retains ambiguous links without inventing resolved connections", () => {
    const notes: Note[] = [
      { path: "source.md", content: "[[same]]" },
      { path: "a/same.md", content: "" },
      { path: "b/same.md", content: "" },
    ];
    const entries: VaultEntry[] = notes.map((note) => ({
      path: note.path,
      kind: "note",
      modified: 1,
    }));
    const graph = buildGraph(notes, entries);
    const unresolved = graph.nodes.find((node) => node.candidates);
    expect(unresolved?.candidates).toEqual(["a/same.md", "b/same.md"]);
    expect(graph.edges).toEqual([{ source: "source.md", target: unresolved?.id }]);
  });
  it("builds a 5,000-note graph within a second", () => {
    const notes: Note[] = Array.from({ length: 5000 }, (_, i) => ({
      path: `folder${i % 20}/note ${i}.md`,
      content: `# Note ${i}\n\n${Array.from({ length: 10 }, (_, k) => `- [[note ${(i * 7 + k * 13) % 5000}]]`).join("\n")}\n\n#tag${i % 30}\n`,
    }));
    const entries: VaultEntry[] = notes.map((note) => ({
      path: note.path,
      kind: "note",
      modified: 1,
    }));
    const started = performance.now();
    const graph = buildGraph(notes, entries);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(graph.edges.length).toBeGreaterThan(5000);
  }, 30_000);
});
