// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaneLayout, type PaneTab } from "../src/core/pane-layout";
import { createPaneSurface, type PaneSurfaceActions } from "../src/ui/pane-surface";

type Subject = {
  readonly layout: PaneLayout;
  readonly surface: ReturnType<typeof createPaneSurface>;
  readonly content: Map<string, HTMLElement>;
  readonly modes: Map<string, "live" | "source" | "reading">;
};

function note(id: string): PaneTab {
  return { id, kind: "note", path: `notes/${id}.md` };
}

function event(type: string, transfer?: { readonly effectAllowed: string }): Event {
  const value = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(value, {
    clientX: { value: 10 },
    clientY: { value: 10 },
    dataTransfer: { value: transfer },
  });
  return value;
}

function subject(): Subject {
  const layout = new PaneLayout();
  const first = layout.activeGroup;
  layout.add(note("a"));
  layout.add(note("b"));
  layout.move("b", { group: first, position: "right" });
  const content = new Map<string, HTMLElement>();
  const modes = new Map<string, "live" | "source" | "reading">();
  let surface: ReturnType<typeof createPaneSurface> | undefined;
  const render = () => surface?.render();
  const actions: PaneSurfaceActions = {
    select: (id) => {
      layout.select(id);
      render();
    },
    focus: (id) => {
      layout.focus(id);
      render();
    },
    close: (id) => {
      layout.close(id);
      render();
    },
    create: vi.fn(),
    menu: vi.fn(),
    mode: (id, mode) => {
      modes.set(id, mode);
      render();
    },
    graph: vi.fn(),
    move: (id, target) => {
      layout.move(id, target);
      render();
    },
    resize: (id, ratio) => {
      layout.setRatio(id, ratio);
      render();
    },
    toggleExplorer: vi.fn(),
    toggleInspector: vi.fn(),
  };
  surface = createPaneSurface({
    parent: document.body,
    layout,
    content: (tab) => {
      const host = document.createElement("div");
      host.dataset["host"] = tab.id;
      content.set(tab.id, host);
      return host;
    },
    mode: (tab) => modes.get(tab.id) ?? "live",
    actions,
  });
  surface.render();
  return { layout, surface, content, modes };
}

beforeEach(() => document.body.replaceChildren());

describe("pane surface", () => {
  it("preserves a focused tab and its content host when rendering unchanged layout", () => {
    const value = subject();
    const tab = document.querySelector<HTMLButtonElement>('[data-pane-tab="a"] [role="tab"]');
    const host = value.content.get("a");
    if (!tab || !host) throw new Error("Test pane tab is missing.");

    tab.focus();
    value.surface.render();

    expect(document.activeElement).toBe(tab);
    expect(value.content.get("a")).toBe(host);
    expect(host.isConnected).toBe(true);
    expect(host.parentElement?.getAttribute("role")).toBe("tabpanel");
    expect(host.parentElement?.getAttribute("aria-labelledby")).toBe(tab.id);
  });

  it("keeps focus inside the active editor when rendering after an edit", () => {
    const value = subject();
    const active = value.layout.group()?.active;
    const host = active ? value.content.get(active) : undefined;
    if (!active || !host) throw new Error("Test active host is missing.");
    host.dataset["viewId"] = active;
    const editor = document.createElement("div");
    editor.tabIndex = 0;
    host.append(editor);

    editor.focus();
    value.surface.render();

    expect(document.activeElement).toBe(editor);
  });

  it("moves an internal drag to the destination tab strip without DataTransfer note data", () => {
    const value = subject();
    const source = document.querySelector<HTMLElement>('[data-pane-tab="a"]');
    const target = document.querySelectorAll<HTMLElement>(".pane-tabs")[1];
    if (!source || !target) throw new Error("Test drag targets are missing.");
    const setData = vi.fn();
    const transfer = { effectAllowed: "", setData };

    source.dispatchEvent(event("dragstart", transfer));
    target.dispatchEvent(event("drop", transfer));

    expect(setData).toHaveBeenCalledWith("application/x-md-web-tab", "a");
    expect(transfer.effectAllowed).toBe("move");
    expect(value.layout.groups()[0]?.tabs).toEqual(["b", "a"]);
  });

  it("updates a split ratio from its keyboard separator", () => {
    const value = subject();
    const separator = document.querySelector<HTMLElement>(".pane-separator");
    if (!separator || value.layout.root.kind !== "split")
      throw new Error("Test separator is missing.");
    const before = value.layout.root.ratio;

    separator.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    expect(value.layout.root.kind === "split" ? value.layout.root.ratio : before).toBeCloseTo(
      before + 0.05,
    );
  });

  it("removes closed tab nodes and hosts while preserving the focused remaining tab", () => {
    const value = subject();
    const remaining = document.querySelector<HTMLButtonElement>('[data-pane-tab="b"] [role="tab"]');
    if (!remaining) throw new Error("Test remaining tab is missing.");

    remaining.focus();
    value.layout.close("a");
    value.surface.render();

    expect(document.querySelector('[data-pane-tab="a"]')).toBeNull();
    expect(value.content.get("a")?.isConnected).toBe(false);
    expect(document.activeElement).toBe(remaining);
  });

  it("removes obsolete split and group DOM after reset", () => {
    const value = subject();
    const tab = document.querySelector<HTMLButtonElement>('[data-pane-tab="a"] [role="tab"]');
    if (!tab) throw new Error("Test reset tab is missing.");

    tab.focus();
    value.layout.reset();
    value.surface.render();

    expect(document.querySelectorAll(".pane-split")).toHaveLength(0);
    expect(document.querySelectorAll(".pane-group")).toHaveLength(1);
    expect(document.querySelector(".pane-empty h2")?.textContent).toBe("빈 작업 그룹");
    expect(document.activeElement).toBe(document.querySelector(".pane-empty button"));
  });

  it("focuses the active transferred tab when moving collapses its former sibling group", () => {
    const value = subject();
    const focused = document.querySelector<HTMLButtonElement>('[data-pane-tab="b"] [role="tab"]');
    const target = value.layout.groups()[1]?.id;
    if (!focused || !target) throw new Error("Test move target is missing.");

    focused.focus();
    value.layout.move("a", { group: target, position: "center" });
    value.surface.render();

    expect(document.activeElement).toBe(document.querySelector('[data-pane-tab="a"] [role="tab"]'));
    expect(document.querySelectorAll(".pane-split")).toHaveLength(0);
  });

  it("keeps nested split handles and content hosts after a mode render", () => {
    const value = subject();
    const first = value.layout.groups()[0]?.id;
    if (!first) throw new Error("Test first group is missing.");

    value.layout.add(note("c"), first);
    value.layout.move("c", { group: first, position: "right" });
    value.surface.render();
    value.modes.set("c", "source");
    value.surface.render();

    const splits = document.querySelectorAll<HTMLElement>(".pane-split");

    expect(splits).toHaveLength(2);
    for (const split of splits) {
      const handles = [...split.children].filter(
        (child) => child instanceof HTMLElement && child.classList.contains("pane-separator"),
      );
      expect(handles).toHaveLength(1);
      expect(handles[0]?.getAttribute("aria-orientation")).toBe("vertical");
    }
    expect([...value.content.values()].every((host) => host.isConnected)).toBe(true);
  });
});
