// @vitest-environment jsdom

import { Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { createEditor } from "../src/editor/editor";

function liveView(parent: HTMLElement): EditorView {
  const surface = parent.querySelector<HTMLElement>(".cm-editor");
  const view = surface ? EditorView.findFromDOM(surface) : null;
  if (!view) throw new Error("Test editor view is missing.");
  return view;
}

describe("CodeMirror editor modes", () => {
  it("mirrors content without a save callback or a history reset", () => {
    const parent = document.createElement("main");
    const changes: string[] = [];
    const editor = createEditor({
      parent,
      content: "base",
      readonly: false,
      mode: "source",
      path: "note.md",
      onChange: (content) => changes.push(content),
      onLink: () => undefined,
      asset: async () => undefined,
      completions: () => [],
    });
    const surface = parent.querySelector<HTMLElement>(".cm-editor");
    const view = surface ? EditorView.findFromDOM(surface) : null;
    if (!view) throw new Error("Expected CodeMirror editor");
    view.dispatch({
      changes: { from: 4, insert: "A" },
      annotations: Transaction.userEvent.of("input.type"),
    });
    editor.syncContent("ZbaseA");
    expect(changes).toEqual(["baseA"]);
    editor.undo();

    expect(changes).toEqual(["baseA", "Zbase"]);
    expect(editor.getContent()).toBe("Zbase");
    editor.destroy();
  });

  it("keeps earlier mirrored text when undoing a local view edit", () => {
    const parent = document.createElement("main");
    const editor = createEditor({
      parent,
      content: "base",
      readonly: false,
      mode: "source",
      path: "note.md",
      onChange: () => undefined,
      onLink: () => undefined,
      asset: async () => undefined,
      completions: () => [],
    });
    const surface = parent.querySelector<HTMLElement>(".cm-editor");
    const view = surface ? EditorView.findFromDOM(surface) : null;
    if (!view) throw new Error("Expected CodeMirror editor");
    editor.syncContent("Zbase");
    view.dispatch({
      changes: { from: 5, insert: "B" },
      annotations: Transaction.userEvent.of("input.type"),
    });
    editor.undo();

    expect(editor.getContent()).toBe("Zbase");
    editor.destroy();
  });

  it("refreshes a reading view when another pane mirrors content", () => {
    const parent = document.createElement("main");
    const editor = createEditor({
      parent,
      content: "# Before",
      readonly: false,
      mode: "reading",
      path: "note.md",
      onChange: () => undefined,
      onLink: () => undefined,
      asset: async () => undefined,
      completions: () => [],
    });
    editor.syncContent("# After");

    expect(parent.querySelector(".markdown-reading")?.textContent).toContain("After");
    editor.destroy();
  });

  it("preserves source, exposes source affordances, and does not save document replacement", () => {
    const parent = document.createElement("main");
    const changes: string[] = [];
    const editor = createEditor({
      parent,
      content: "# First\ntext",
      readonly: false,
      mode: "source",
      path: "first.md",
      onChange: (content) => changes.push(content),
      onLink: () => undefined,
      asset: async () => undefined,
      completions: () => ["first.md"],
    });
    expect(parent.querySelector(".cm-gutters")).not.toBeNull();
    editor.setDocument("exact **source**", "second.md");
    expect(editor.getContent()).toBe("exact **source**");
    expect(changes).toEqual([]);
    editor.setMode("reading");
    expect(parent.querySelector(".markdown-reading")?.textContent).toContain("exact source");
    editor.destroy();
  });

  it("formats the command-palette link action as an exact wiki link", () => {
    const parent = document.createElement("main");
    const editor = createEditor({
      parent,
      content: "",
      readonly: false,
      mode: "source",
      path: "note.md",
      onChange: () => undefined,
      onLink: () => undefined,
      asset: async () => undefined,
      completions: () => ["target.md"],
    });
    editor.format("link");
    expect(editor.getContent()).toBe("[[]]");
    editor.destroy();
  });

  it("formats a selected known file as the canonical root-explicit wiki link", () => {
    const parent = document.createElement("main");
    const editor = createEditor({
      parent,
      content: "설명서",
      readonly: false,
      mode: "source",
      path: "note.md",
      onChange: () => undefined,
      onLink: () => undefined,
      asset: async () => undefined,
      completions: () => ["자료/설명서.pdf"],
    });
    const surface = parent.querySelector<HTMLElement>(".cm-editor");
    const view = surface ? EditorView.findFromDOM(surface) : null;
    if (!surface || !view) throw new Error("Expected CodeMirror editor");
    view.dispatch({ selection: { anchor: 0, head: "설명서".length } });
    editor.format("link");
    expect(editor.getContent()).toBe("[[/자료/설명서.pdf|설명서]]");
    editor.destroy();
  });

  it("canonicalizes a newly typed resolvable wiki link without changing untouched links", () => {
    const parent = document.createElement("main");
    const editor = createEditor({
      parent,
      content: "[[unchanged]]\n\n",
      readonly: false,
      mode: "source",
      path: "notes/current.md",
      onChange: () => undefined,
      onLink: () => undefined,
      asset: async () => undefined,
      completions: () => ["자료/설명서.pdf"],
    });
    const surface = parent.querySelector<HTMLElement>(".cm-editor");
    const view = surface ? EditorView.findFromDOM(surface) : null;
    if (!view) throw new Error("Expected CodeMirror editor");
    const position = editor.getContent().length;
    view.dispatch({
      changes: { from: position, insert: "[[설명서]]" },
      annotations: Transaction.userEvent.of("input.type"),
    });
    expect(editor.getContent()).toBe("[[unchanged]]\n\n[[/자료/설명서.pdf|설명서]]");
    editor.destroy();
  });

  it("leaves ambiguous and fenced-code wiki text unchanged after input", () => {
    const parent = document.createElement("main");
    const editor = createEditor({
      parent,
      content: "```md\n",
      readonly: false,
      mode: "source",
      path: "notes/current.md",
      onChange: () => undefined,
      onLink: () => undefined,
      asset: async () => undefined,
      completions: () => ["a/report.md", "b/report.md"],
    });
    const surface = parent.querySelector<HTMLElement>(".cm-editor");
    const view = surface ? EditorView.findFromDOM(surface) : null;
    if (!view) throw new Error("Expected CodeMirror editor");
    view.dispatch({
      changes: {
        from: editor.getContent().length,
        insert: "[[report]]\n```\n\n`[[report]]`\n\n[[report]]",
      },
      annotations: Transaction.userEvent.of("input.paste"),
    });
    expect(editor.getContent()).toBe("```md\n[[report]]\n```\n\n`[[report]]`\n\n[[report]]");
    editor.destroy();
  });

  it("writes a newly typed unknown wiki target as a root Markdown path", () => {
    const parent = document.createElement("main");
    const editor = createEditor({
      parent,
      content: "",
      readonly: false,
      mode: "source",
      path: "notes/current.md",
      onChange: () => undefined,
      onLink: () => undefined,
      asset: async () => undefined,
      completions: () => [],
    });
    const surface = parent.querySelector<HTMLElement>(".cm-editor");
    const view = surface ? EditorView.findFromDOM(surface) : null;
    if (!view) throw new Error("Expected CodeMirror editor");
    view.dispatch({
      changes: { from: 0, insert: "[[draft]]" },
      annotations: Transaction.userEvent.of("input.type"),
    });
    expect(editor.getContent()).toBe("[[/draft.md|draft]]");
    editor.destroy();
  });

  it("preserves a composing alias and anchor until a normal input closes a new Korean link", () => {
    const parent = document.createElement("main");
    const editor = createEditor({
      parent,
      content: "[[초안#소개|별칭]]",
      readonly: false,
      mode: "source",
      path: "notes/current.md",
      onChange: () => undefined,
      onLink: () => undefined,
      asset: async () => undefined,
      completions: () => ["자료/한글.md"],
    });
    const surface = parent.querySelector<HTMLElement>(".cm-editor");
    const view = surface ? EditorView.findFromDOM(surface) : null;
    if (!surface || !view) throw new Error("Expected CodeMirror editor");
    view.dispatch({
      changes: { from: 2, to: 4, insert: "한글" },
      annotations: Transaction.userEvent.of("input.type.compose"),
    });
    expect(editor.getContent()).toBe("[[한글#소개|별칭]]");
    editor.setDocument("[[", "notes/current.md");
    const composingView = EditorView.findFromDOM(surface);
    if (!composingView) throw new Error("Expected CodeMirror editor");
    composingView.dispatch({
      changes: { from: 2, insert: "한글" },
      annotations: Transaction.userEvent.of("input.type.compose"),
    });
    expect(editor.getContent()).toBe("[[한글");
    composingView.dispatch({
      changes: { from: editor.getContent().length, insert: "]]" },
      annotations: Transaction.userEvent.of("input.type"),
    });
    expect(editor.getContent()).toBe("[[/자료/한글.md|한글]]");
    editor.undo();
    expect(editor.getContent()).toBe("[[");
    editor.redo();
    expect(editor.getContent()).toBe("[[/자료/한글.md|한글]]");
    editor.destroy();
  });

  it("renders a delimiter-containing filename through its decoded fallback label", () => {
    const parent = document.createElement("main");
    const editor = createEditor({
      parent,
      content: "[[/report%5Bfinal%5D.txt]]",
      readonly: false,
      mode: "reading",
      path: "note.md",
      onChange: () => undefined,
      onLink: () => undefined,
      asset: async () => undefined,
      completions: () => ["report[final].txt"],
    });
    expect(
      parent.querySelector<HTMLElement>("[data-md-href='/report%5Bfinal%5D.txt']")?.textContent,
    ).toBe("report[final].txt");
    editor.destroy();
  });

  it("renders inactive blocks and persists an interactive task toggle", () => {
    const parent = document.createElement("main");
    const links: string[] = [];
    const editor = createEditor({
      parent,
      content: "# Active\n\n**bold** [[target|Target]]\n\n- [ ] task",
      readonly: false,
      mode: "live",
      path: "note.md",
      onChange: () => undefined,
      onLink: (target) => links.push(target),
      asset: async () => undefined,
      completions: () => [],
    });
    expect(parent.querySelector(".markdown-reading strong")?.textContent).toBe("bold");
    parent.querySelector<HTMLElement>("[data-md-href=target]")?.click();
    expect(links).toEqual(["target"]);
    parent.querySelector<HTMLElement>(".task-checkbox")?.click();
    expect(editor.getContent()).toContain("[x] task");
    editor.destroy();
  });

  it("maps rendered task controls to actual task-list markers only", () => {
    const parent = document.createElement("main");
    const editor = createEditor({
      parent,
      content: "# Active\n\n- [ ] first\n- explanatory [ ] text\n- [ ] second",
      readonly: false,
      mode: "live",
      path: "note.md",
      onChange: () => undefined,
      onLink: () => undefined,
      asset: async () => undefined,
      completions: () => [],
    });
    parent.querySelectorAll<HTMLElement>(".task-checkbox")[1]?.click();
    expect(editor.getContent()).toContain("- [ ] first");
    expect(editor.getContent()).toContain("- explanatory [ ] text");
    expect(editor.getContent()).toContain("- [x] second");
    editor.destroy();
  });

  it("excludes fenced fake tasks and maps quote-prefixed task markers", () => {
    const parent = document.createElement("main");
    const editor = createEditor({
      parent,
      content:
        "# Active\n\n- [ ] first\n  ```\n  - [ ] fake\n  ```\n- [ ] second\n\n> - [ ] quoted",
      readonly: false,
      mode: "live",
      path: "note.md",
      onChange: () => undefined,
      onLink: () => undefined,
      asset: async () => undefined,
      completions: () => [],
    });
    const boxes = parent.querySelectorAll<HTMLElement>(".task-checkbox");
    boxes[1]?.click();
    boxes[2]?.click();
    expect(editor.getContent()).toContain("- [ ] fake");
    expect(editor.getContent()).toContain("- [x] second");
    expect(editor.getContent()).toContain("> - [x] quoted");
    editor.destroy();
  });

  it("keeps loose-list paragraphs while mapping the second task checkbox", () => {
    const parent = document.createElement("main");
    const editor = createEditor({
      parent,
      content: "# Active\n\n- [ ] first\n\n- [ ] second",
      readonly: false,
      mode: "live",
      path: "note.md",
      onChange: () => undefined,
      onLink: () => undefined,
      asset: async () => undefined,
      completions: () => [],
    });
    const boxes = parent.querySelectorAll<HTMLElement>(".task-checkbox");
    expect(boxes).toHaveLength(2);
    boxes[1]?.click();
    expect(editor.getContent()).toContain("- [ ] first\n\n- [x] second");
    editor.destroy();
  });

  it("maps a continuation-line task to its exact source marker", () => {
    const parent = document.createElement("main");
    const editor = createEditor({
      parent,
      content: "# Active\n\n-\n  [ ] continuation task",
      readonly: false,
      mode: "live",
      path: "note.md",
      onChange: () => undefined,
      onLink: () => undefined,
      asset: async () => undefined,
      completions: () => [],
    });
    parent.querySelector<HTMLElement>(".task-checkbox")?.click();
    expect(editor.getContent()).toContain("  [x] continuation task");
    editor.destroy();
  });

  it("maps a multiline task whose parsed inline text strips continuation indentation", () => {
    const parent = document.createElement("main");
    const editor = createEditor({
      parent,
      content: "# Active\n\n- [ ] task\n  continuation text",
      readonly: false,
      mode: "live",
      path: "note.md",
      onChange: () => undefined,
      onLink: () => undefined,
      asset: async () => undefined,
      completions: () => [],
    });
    parent.querySelector<HTMLElement>(".task-checkbox")?.click();
    expect(editor.getContent()).toContain("- [x] task\n  continuation text");
    editor.destroy();
  });

  it("retains inactive preview widgets while selection stays in one block", () => {
    const parent = document.createElement("main");
    let assetCalls = 0;
    const editor = createEditor({
      parent,
      content: "active\ncontinued\n\n![image](asset.png)",
      readonly: false,
      mode: "live",
      path: "note.md",
      onChange: () => undefined,
      onLink: () => undefined,
      asset: async () => {
        assetCalls += 1;
        return undefined;
      },
      completions: () => [],
    });
    editor.goToLine(2);
    expect(assetCalls).toBe(1);
    editor.destroy();
  });

  it("keeps CRLF line endings for typed, pasted, and synced text", () => {
    const parent = document.createElement("main");
    const changes: string[] = [];
    const editor = createEditor({
      parent,
      content: "a\r\nb",
      readonly: false,
      mode: "source",
      path: "note.md",
      onChange: (content) => changes.push(content),
      onLink: () => undefined,
      asset: async () => undefined,
      completions: () => [],
    });
    const view = liveView(parent);
    view.dispatch({ changes: { from: view.state.doc.length, insert: "x" } });
    view.dispatch({ changes: { from: view.state.doc.length, insert: "\nX" } });
    expect(changes).toEqual(["a\r\nbx", "a\r\nbx\r\nX"]);
    editor.syncContent("a\r\nb\r\nc");
    expect(view.state.doc.lines).toBe(3);
    expect(editor.getContent()).toBe("a\r\nb\r\nc");
    editor.destroy();
  });

  it("reuses inactive preview widgets when typing shifts them", () => {
    const parent = document.createElement("main");
    let assetCalls = 0;
    const editor = createEditor({
      parent,
      content: "intro\n\n![image](asset.png)\n\nend",
      readonly: false,
      mode: "live",
      path: "note.md",
      onChange: () => undefined,
      onLink: () => undefined,
      asset: async () => {
        assetCalls += 1;
        return undefined;
      },
      completions: () => [],
    });
    const view = liveView(parent);
    for (let i = 0; i < 3; i += 1)
      view.dispatch({
        changes: { from: 0, insert: "x" },
        annotations: Transaction.userEvent.of("input.type"),
      });
    expect(assetCalls).toBe(1);
    editor.destroy();
  });

  it("toggles the clicked task after text above it moves", () => {
    const parent = document.createElement("main");
    const editor = createEditor({
      parent,
      content: "intro\n\n- [ ] task",
      readonly: false,
      mode: "live",
      path: "note.md",
      onChange: () => undefined,
      onLink: () => undefined,
      asset: async () => undefined,
      completions: () => [],
    });
    liveView(parent).dispatch({ changes: { from: 0, insert: "abc" } });
    parent.querySelector<HTMLElement>(".task-checkbox")?.click();
    expect(editor.getContent()).toBe("abcintro\n\n- [x] task");
    editor.destroy();
  });

  it("jumps to the current footnote definition after text above it moves", () => {
    const parent = document.createElement("main");
    const editor = createEditor({
      parent,
      content: "# Active\n\nfootnote[^1]\n\n[^1]: definition",
      readonly: false,
      mode: "live",
      path: "note.md",
      onChange: () => undefined,
      onLink: () => undefined,
      asset: async () => undefined,
      completions: () => [],
    });
    const view = liveView(parent);
    view.dispatch({ changes: { from: 0, insert: "abc" } });
    parent.querySelector<HTMLElement>("[data-md-footnote='1']")?.click();
    expect(view.state.selection.main.head).toBe(view.state.doc.toString().indexOf("[^1]:"));
    editor.destroy();
  });

  it("returns a plain rendered block to source editing on pointer selection", () => {
    const parent = document.createElement("main");
    const editor = createEditor({
      parent,
      content: "# Active\n\nplain prose",
      readonly: false,
      mode: "live",
      path: "note.md",
      onChange: () => undefined,
      onLink: () => undefined,
      asset: async () => undefined,
      completions: () => [],
    });
    const prose = parent.querySelector<HTMLElement>(".markdown-reading p");
    prose?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(parent.querySelector(".markdown-reading p")).toBeNull();
    editor.format("bold");
    expect(editor.getContent()).toContain("**");
    editor.destroy();
  });

  it("shares references and footnotes across inactive live-preview blocks", () => {
    const parent = document.createElement("main");
    const links: string[] = [];
    const editor = createEditor({
      parent,
      content:
        "# Active\n\n[reference][start]\n\n[start]: ../start.md\n\nfootnote[^1]\n\n[^1]: text",
      readonly: false,
      mode: "live",
      path: "folder/note.md",
      onChange: () => undefined,
      onLink: (target) => links.push(target),
      asset: async () => undefined,
      completions: () => [],
    });
    const link = parent.querySelector<HTMLElement>("[data-md-href='../start.md']");
    expect(link?.getAttribute("href")).toBeNull();
    link?.click();
    expect(links).toEqual(["../start.md"]);
    expect(parent.querySelectorAll(".footnotes")).toHaveLength(0);
    expect(parent.querySelector(".footnote-ref")?.textContent).toBe("[1]");
    editor.destroy();
  });

  it("opens an indented live footnote definition at its source marker", () => {
    const parent = document.createElement("main");
    const editor = createEditor({
      parent,
      content: "# Active\n\nfootnote[^1]\n\n   [^1]: definition",
      readonly: false,
      mode: "live",
      path: "note.md",
      onChange: () => undefined,
      onLink: () => undefined,
      asset: async () => undefined,
      completions: () => [],
    });
    parent.querySelector<HTMLElement>("[data-md-footnote='1']")?.click();
    expect(parent.querySelector(".cm-content")?.textContent).toContain("[^1]: definition");
    editor.destroy();
  });

  it("never applies programmatic formatting while readonly", () => {
    const parent = document.createElement("main");
    const editor = createEditor({
      parent,
      content: "plain",
      readonly: true,
      mode: "source",
      path: "note.md",
      onChange: () => undefined,
      onLink: () => undefined,
      asset: async () => undefined,
      completions: () => [],
    });
    editor.format("link");
    editor.undo();
    editor.redo();
    expect(editor.getContent()).toBe("plain");
    editor.destroy();
  });
});
