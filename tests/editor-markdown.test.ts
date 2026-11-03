import { describe, expect, it } from "vitest";
import {
  canonicalWikiLink,
  indexDocument,
  markdownContext,
  resolveLink,
} from "../src/editor/markdown";

describe("Markdown document indexing", () => {
  it("indexes supported links and headings while excluding fenced code", () => {
    const index = indexDocument(
      `# Café\n[[folder/한글|별칭]] and [reference][r] #tag\n\n[r]: ../two.md\n\n\`\`\`md\n[[ignored]] #nope\n\`\`\``,
    );
    expect(index.headings).toEqual([{ level: 1, text: "Café", line: 1, id: "café" }]);
    expect(index.links).toEqual([
      { target: "folder/한글", label: "별칭", kind: "wiki" },
      { target: "../two.md", label: "reference", kind: "markdown" },
    ]);
    expect(index.tags).toEqual(["tag"]);
  });
});

describe("vault link resolution", () => {
  const paths = ["one.md", "folder/two.markdown", "a/same.md", "b/same.md", "한글.md"];

  it("uses the documented wiki and Markdown lookup ordering", () => {
    expect(resolveLink("folder/current.md", "two", paths, "wiki")).toEqual({
      kind: "note",
      path: "folder/two.markdown",
      anchor: "",
    });
    expect(resolveLink("folder/current.md", "../one", paths, "markdown")).toEqual({
      kind: "note",
      path: "one.md",
      anchor: "",
    });
    expect(resolveLink("folder/current.md", "%ED%95%9C%EA%B8%80#title", paths, "wiki")).toEqual({
      kind: "note",
      path: "한글.md",
      anchor: "title",
    });
    expect(resolveLink("folder/current.md", "same", paths, "wiki")).toEqual({
      kind: "ambiguous",
      paths: ["a/same.md", "b/same.md"],
    });
  });

  it("blocks URLs and vault traversal", () => {
    expect(resolveLink("folder/current.md", "../../escape", paths)).toEqual({ kind: "blocked" });
    expect(resolveLink("folder/current.md", "//tracker.invalid/pixel", paths)).toEqual({
      kind: "blocked",
    });
    expect(resolveLink("folder/current.md", "javascript:alert(1)", paths)).toEqual({
      kind: "blocked",
    });
    expect(resolveLink("folder/current.md", "%68ttps%3A%2F%2Ftracker.invalid", paths)).toEqual({
      kind: "external",
      url: "https://tracker.invalid/",
    });
  });

  it("resolves root-explicit wiki and Markdown targets only from the vault root", () => {
    const paths = ["folder/current.md", "folder/guide.md", "manual.md"];
    expect(resolveLink("folder/current.md", "/manual.md", paths, "wiki")).toEqual({
      kind: "note",
      path: "manual.md",
      anchor: "",
    });
    expect(resolveLink("folder/current.md", "/manual.md", paths, "markdown")).toEqual({
      kind: "note",
      path: "manual.md",
      anchor: "",
    });
    expect(resolveLink("folder/current.md", "/guide", paths, "wiki")).toEqual({
      kind: "missing",
      path: "guide.md",
      anchor: "",
    });
    expect(resolveLink("folder/current.md", "/docs/report.pdf", paths, "wiki")).toEqual({
      kind: "missing",
      path: "docs/report.pdf",
      anchor: "",
    });
  });

  it("keeps encoded filename punctuation in the path instead of treating it as an anchor", () => {
    const paths = ["folder/current.md", "folder/a#b%.md"];
    expect(resolveLink("folder/current.md", "/folder/a%23b%25.md#details", paths)).toEqual({
      kind: "note",
      path: "folder/a#b%.md",
      anchor: "details",
    });
  });

  it("writes canonical root-explicit wiki links with readable aliases", () => {
    expect(canonicalWikiLink("자료/설명서.pdf")).toBe("[[/자료/설명서.pdf|설명서]]");
    expect(canonicalWikiLink("folder/a#b%.md")).toBe("[[/folder/a%23b%25.md|a#b%]]");
    const bracketed = canonicalWikiLink("report[final].txt");
    expect(bracketed).toBe("[[/report%5Bfinal%5D.txt]]");
    expect(indexDocument(bracketed).links).toEqual([
      { target: "/report%5Bfinal%5D.txt", label: "report[final].txt", kind: "wiki" },
    ]);
  });

  it("lists case-insensitive extension matches in vault order", () => {
    expect(resolveLink("x.md", "notes/Plan", ["notes/plan.markdown", "notes/PLAN.md"])).toEqual({
      kind: "ambiguous",
      paths: ["notes/plan.markdown", "notes/PLAN.md"],
    });
  });

  it("resolves 20,000 links across 2,000 notes within a second", () => {
    const paths = Array.from({ length: 2000 }, (_, i) => `folder${i % 20}/note ${i}.md`);
    const started = performance.now();
    for (const [i, source] of paths.entries())
      for (let k = 0; k < 10; k += 1)
        resolveLink(source, `note ${(i * 7 + k * 13) % 2000}`, paths, "wiki");
    expect(performance.now() - started).toBeLessThan(1000);
  }, 30_000);
});

describe("Markdown parser context", () => {
  it("records parsed indented footnotes and excludes fenced lookalikes", () => {
    const content = "note[^1]\n\n   [^1]: definition\n\n```md\n[^2]: fake\n```";
    const context = markdownContext(content);
    expect(context.footnotes.get("1")).toBe(content.indexOf("[^1]: definition"));
    expect(context.footnotes.has("2")).toBe(false);
  });
});
