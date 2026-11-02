import type { PaneNode } from "../core/pane-layout";
import { createPaneDrag } from "./pane-drag";
import { installPaneResize } from "./pane-resize";
import {
  createPaneGroupRenderer,
  type PaneGroupDom,
  type PaneTabDom,
  paneLabel,
} from "./pane-surface-group";
import type { PaneSurfaceOptions } from "./pane-surface-types";

export type { PaneSurfaceActions, PaneSurfaceOptions } from "./pane-surface-types";

function contains(node: PaneNode, group: string): boolean {
  return node.kind === "group"
    ? node.id === group
    : contains(node.first, group) || contains(node.second, group);
}

function ratio(node: PaneNode, splitId: string): number | undefined {
  if (node.kind === "group") return undefined;
  if (node.id === splitId) return node.ratio;
  return ratio(node.first, splitId) ?? ratio(node.second, splitId);
}

function splitIds(node: PaneNode, ids = new Set<string>()): ReadonlySet<string> {
  if (node.kind === "split") {
    ids.add(node.id);
    splitIds(node.first, ids);
    splitIds(node.second, ids);
  }
  return ids;
}

function appendInOrder(parent: HTMLElement, children: readonly HTMLElement[]): void {
  for (const [index, child] of children.entries()) {
    if (parent.children[index] !== child)
      parent.insertBefore(child, parent.children[index] ?? null);
  }
}

function splitHandle(split: HTMLElement): HTMLElement | undefined {
  return [...split.children].find(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.classList.contains("pane-separator"),
  );
}

export function createPaneSurface(options: PaneSurfaceOptions): {
  readonly render: () => void;
  readonly destroy: () => void;
} {
  const surface = document.createElement("section");
  surface.className = "pane-surface";
  surface.setAttribute("aria-label", "분할 작업 영역");
  const selector = document.createElement("label");
  selector.className = "pane-group-selector";
  const select = document.createElement("select");
  selector.append("작업 그룹", select);
  const tree = document.createElement("div");
  tree.className = "pane-tree";
  surface.append(selector, tree);
  options.parent.append(surface);
  const groups = new Map<string, PaneGroupDom>();
  const splits = new Map<string, HTMLElement>();
  const tabs = new Map<string, PaneTabDom>();
  const hosts = new Map<string, HTMLElement>();
  const drag = createPaneDrag({ move: options.actions.move });
  let restoringFocus = false;
  const groupDom = createPaneGroupRenderer({
    ...options,
    drag,
    groups,
    tabs,
    hosts,
    focus: (groupId) => {
      if (!restoringFocus) options.actions.focus(groupId);
    },
  });

  const nodeDom = (node: PaneNode): HTMLElement => {
    if (node.kind === "group") return groupDom(node);
    let split = splits.get(node.id);
    if (!split) {
      split = document.createElement("div");
      split.className = "pane-node pane-split";
      split.dataset["paneSplit"] = node.id;
      const handle = document.createElement("div");
      handle.className = "pane-separator";
      installPaneResize({
        split,
        handle,
        axis: node.axis,
        ratio: () => ratio(options.layout.root, node.id) ?? node.ratio,
        set: (value) => options.actions.resize(node.id, value),
      });
      split.append(handle);
      splits.set(node.id, split);
    }
    split.dataset["axis"] = node.axis;
    split.style.setProperty("--pane-first", `${node.ratio}fr`);
    split.style.setProperty("--pane-second", `${1 - node.ratio}fr`);
    split.classList.toggle(
      "pane-node--contains-active",
      contains(node, options.layout.activeGroup),
    );
    const handle = splitHandle(split);
    if (!handle) throw new Error("Pane split is missing its separator.");
    handle.setAttribute("aria-valuenow", String(Math.round(node.ratio * 100)));
    appendInOrder(split, [nodeDom(node.first), handle, nodeDom(node.second)]);
    return split;
  };

  const prune = () => {
    const currentGroups = new Set(options.layout.groups().map((group) => group.id));
    const currentTabs = new Set(options.layout.tabs.keys());
    for (const [id, dom] of tabs) {
      if (currentTabs.has(id)) continue;
      dom.node.remove();
      tabs.delete(id);
      hosts.get(id)?.remove();
      hosts.delete(id);
    }
    for (const [id, dom] of groups) {
      if (currentGroups.has(id)) continue;
      dom.node.remove();
      groups.delete(id);
    }
    const currentSplits = splitIds(options.layout.root);
    for (const [id, dom] of splits) {
      if (currentSplits.has(id)) continue;
      dom.remove();
      splits.delete(id);
    }
  };

  const render = () => {
    const focused =
      document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const focusWasInSurface = focused ? surface.contains(focused) : false;
    const focusedGroup = focused?.closest<HTMLElement>("[data-pane-group]")?.dataset["paneGroup"];
    const focusedTab =
      focused?.closest<HTMLElement>("[data-pane-tab]")?.dataset["paneTab"] ??
      focused?.closest<HTMLElement>("[data-view-id]")?.dataset["viewId"];
    prune();
    select.replaceChildren(
      ...options.layout.groups().map((group, index) => {
        const option = document.createElement("option");
        option.value = group.id;
        option.textContent = `작업 그룹 ${index + 1}${group.active ? ` · ${paneLabel(options.layout.tabs.get(group.active) ?? { id: "", kind: "graph", local: false })}` : ""}`;
        option.selected = group.id === options.layout.activeGroup;
        return option;
      }),
    );
    select.onchange = () => options.actions.focus(select.value);
    const root = nodeDom(options.layout.root);
    if (tree.firstElementChild !== root) tree.replaceChildren(root);
    const keepFocus =
      focused?.isConnected &&
      focusedGroup === options.layout.activeGroup &&
      (!focusedTab || options.layout.group()?.active === focusedTab);
    const nextFocus = keepFocus
      ? document.activeElement === focused
        ? undefined
        : focused
      : focusWasInSurface
        ? surface.querySelector<HTMLElement>(
            ".pane-group.is-focused [role=tab][aria-selected=true], .pane-group.is-focused .pane-empty button",
          )
        : undefined;
    if (nextFocus) {
      restoringFocus = true;
      nextFocus.focus({ preventScroll: true });
      restoringFocus = false;
    }
  };

  return {
    render,
    destroy: () => {
      drag.clear();
      surface.remove();
      groups.clear();
      splits.clear();
      tabs.clear();
      hosts.clear();
    },
  };
}
