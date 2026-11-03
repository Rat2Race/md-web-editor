import { describe, expect, it } from "vitest";
import { canonicalWikiEdits } from "../src/editor/wiki-edits";

function edits(content: string) {
  return canonicalWikiEdits({
    content,
    source: "notes/current.md",
    paths: ["docs/report.pdf"],
    changed: [{ from: 0, to: content.length }],
  });
}

describe("wiki edit canonicalization", () => {
  it("keeps a missing explicit-root target rooted instead of matching a same-named file", () => {
    const content = "[[/wrong/report.pdf]]";
    expect(edits(content)).toEqual([
      { from: 0, to: content.length, insert: "[[/wrong/report.pdf|report]]" },
    ]);
  });

  it("writes unknown names at the vault root", () => {
    expect(edits("[[draft]]")).toEqual([{ from: 0, to: 9, insert: "[[/draft.md|draft]]" }]);
  });

  it("rewrites only prose wiki text, excluding Markdown and HTML syntax ranges", () => {
    const content = [
      "    [[report]]",
      "> ```md",
      "> [[report]]",
      "> ```",
      "",
      "- item",
      "  ```md",
      "  [[report]]",
      "  ```",
      "",
      "`before",
      "[[report]]",
      "after`",
      "",
      "\\[[report]]",
      "",
      "[text]([[report]])",
      "",
      '<span data-link="[[report]]">text</span>',
      "",
      "[[report]]",
    ].join("\n");
    const from = content.lastIndexOf("[[report]]");
    expect(edits(content)).toEqual([
      { from, to: from + "[[report]]".length, insert: "[[/docs/report.pdf|report]]" },
    ]);
  });

  it("skips parsing a 1 MB note when the keystroke touches no wiki link", () => {
    const paragraph = "Some text with a [[link]] and `code` and **bold** words here.\n\n";
    const content = paragraph.repeat(Math.ceil((1024 * 1024) / paragraph.length));
    const started = performance.now();
    for (let i = 0; i < 5; i += 1)
      canonicalWikiEdits({
        content,
        source: "a.md",
        paths: [],
        changed: [{ from: 5, to: 6 }],
      });
    expect((performance.now() - started) / 5).toBeLessThan(100);
  });
});
