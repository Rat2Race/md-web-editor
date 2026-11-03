import { indexDocument, resolveLink } from "../editor/markdown";
import { isNotePath, normalizePath } from "../storage/paths";
import { showChoices } from "../ui/commands";
import { askText, openDialog } from "../ui/dialog";
import { element } from "../ui/dom";
import type { NoteLink } from "./types";
import type { Workspace } from "./workspace";
import { readWorkspaceNotes, skippedNotice } from "./workspace-data";

export async function followGraphNode(workspace: Workspace, id: string): Promise<void> {
  const node = workspace.graphData().nodes.find((item) => item.id === id);
  if (!node) return;
  if (node.candidates) {
    showChoices(
      "같은 이름의 노트",
      node.candidates.map((path) => ({
        label: path,
        run: () => workspace.run(() => workspace.open(path)),
      })),
    );
  } else if (node.kind === "missing") openMissingTarget(workspace, node.id);
  else if (node.kind === "note") await workspace.open(node.id);
  else if (node.kind === "asset") await workspace.open(node.id);
}

export async function followWorkspaceLink(
  workspace: Workspace,
  target: string,
  kind?: NoteLink["kind"],
): Promise<void> {
  const source = workspace.sessions?.active ?? "";
  const sourceGroup = workspace.panes.layout.activeGroup;
  const result =
    kind === undefined && workspace.notes.has(target)
      ? { kind: "note" as const, path: target, anchor: "" }
      : resolveLink(
          source,
          target,
          workspace.vault?.entries.map((entry) => entry.path) ?? [],
          kind,
        );
  if (result.kind === "external") {
    const { dialog, body } = openDialog("외부 링크 열기");
    body.append(
      element(
        "p",
        "muted",
        "이 주소를 열면 외부 사이트에 접속합니다. 노트 내용은 전송하지 않습니다.",
      ),
      element("p", "external-destination", result.url),
    );
    const link = element("a", "button primary", "외부 사이트 열기");
    link.href = result.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.referrerPolicy = "no-referrer";
    link.addEventListener("click", () => dialog.close());
    body.append(link);
    return;
  }
  if (result.kind === "blocked") {
    workspace.notice("안전하지 않거나 지원하지 않는 링크입니다.");
    return;
  }
  if (result.kind === "ambiguous") {
    showChoices(
      "같은 이름의 노트",
      result.paths.map((path) => ({
        label: path,
        run: () => workspace.run(() => workspace.open(path, sourceGroup)),
      })),
    );
    return;
  }
  if (result.kind === "missing") {
    openMissingTarget(workspace, result.path);
    return;
  }
  await workspace.open(result.path, sourceGroup);
  if (!result.anchor) return;
  const group = workspace.panes.layout.group(sourceGroup);
  const view = group?.active && workspace.sessions?.views.get(group.active);
  if (!view || view.path !== result.path) return;
  const note = workspace.notes.get(result.path);
  const anchor = result.anchor.replace(/^#/, "");
  const heading =
    note &&
    indexDocument(note.content).headings.find((item) => item.id === anchor || item.text === anchor);
  if (heading) view.editor.goToLine(heading.line);
  else if (note && anchor.startsWith("^")) {
    const line = note.content.split("\n").findIndex((text) => text.trimEnd().endsWith(anchor));
    if (line >= 0) view.editor.goToLine(line + 1);
  }
}

function openMissingTarget(workspace: Workspace, path: string): void {
  if (isNotePath(path)) createWorkspaceNote(workspace, path);
  else workspace.notice(`파일을 찾지 못했습니다: ${path}. 폴더를 새로고침해 보세요.`);
}

export function createWorkspaceNote(workspace: Workspace, initial = "새 노트.md"): void {
  const vault = workspace.vault;
  const group = workspace.panes.layout.activeGroup;
  if (!vault) {
    workspace.notice("먼저 폴더 또는 예제 공간을 여세요.");
    return;
  }
  if (vault.kind === "readonly") {
    workspace.notice("읽기 전용 폴더입니다. Chrome 또는 Edge에서 폴더를 다시 여세요.");
    return;
  }
  askText("새 노트", initial, async (value) => {
    const path = normalizePath(/\.(md|markdown)$/i.test(value) ? value : `${value}.md`);
    const title =
      path
        .split("/")
        .at(-1)
        ?.replace(/\.(md|markdown)$/i, "") ?? "새 노트";
    const snapshot = await vault.create(path, `# ${title}\n\n`);
    await vault.refresh();
    if (vault !== workspace.vault) return;
    workspace.notes.set(path, { path, content: snapshot.content });
    await workspace.open(path, workspace.panes.layout.group(group) ? group : undefined);
    workspace.render();
    workspace.panes.updateGraphs();
  });
}

export async function refreshWorkspace(workspace: Workspace): Promise<void> {
  const vault = workspace.vault;
  const sessions = workspace.sessions;
  const token = workspace.version();
  if (!vault) return;
  const release = sessions?.hold() ?? (() => undefined);
  try {
    if (!(await workspace.canLeave())) return;
    await vault.refresh();
    const { notes: next, skipped } = await readWorkspaceNotes(vault);
    if (token !== workspace.version() || vault !== workspace.vault) return;
    for (const session of [...(sessions?.items.values() ?? [])]) {
      if (next.has(session.path)) {
        const reloaded = await sessions?.reload(session.path);
        if (!reloaded) {
          const current = sessions?.items.get(session.path);
          if (current)
            next.set(session.path, { path: session.path, content: current.editor.getContent() });
        }
      } else if (!(await sessions?.close(session.path)))
        next.set(session.path, { path: session.path, content: session.editor.getContent() });
    }
    if (token !== workspace.version() || vault !== workspace.vault) return;
    workspace.notes.clear();
    for (const [path, note] of next) workspace.notes.set(path, note);
    for (const tab of [...workspace.panes.layout.tabs.values()])
      if (tab.kind === "note" && !sessions?.views.has(tab.id)) workspace.panes.layout.close(tab.id);
    const active = workspace.panes.layout.group()?.active;
    if (active) workspace.panes.select(active, false);
    workspace.render();
    workspace.panes.updateGraphs();
    workspace.notice(`폴더의 변경 내용을 확인했습니다.${skippedNotice(skipped, vault.hidden)}`);
  } finally {
    release();
  }
}
