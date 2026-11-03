import { showAttachment } from "../ui/attachment";
import { appendNotice, element } from "../ui/dom";
import type { Shell } from "../ui/shell";
import { renderWorkspace } from "../ui/workspace-view";
import { buildGraph } from "./graph-data";
import { Sessions } from "./sessions";
import type { EditorMode, Note, NoteLink, Vault } from "./types";
import { initialWorkspaceNote, readWorkspaceNotes, skippedNotice } from "./workspace-data";
import { createWorkspaceNote, followWorkspaceLink, refreshWorkspace } from "./workspace-operations";
import { WorkspacePanes } from "./workspace-panes";
export class Workspace {
  vault: Vault | undefined;
  sessions: Sessions | undefined;
  readonly notes = new Map<string, Note>();
  readonly panes: WorkspacePanes;
  private generation = 0;
  private indexTimer: ReturnType<typeof setTimeout> | undefined;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(readonly shell: Shell) {
    this.panes = new WorkspacePanes(this);
    window.addEventListener("beforeunload", (event) => {
      if (this.sessions?.pending()) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void this.sessions?.flush();
    });
    shell.search.addEventListener("input", () => this.render());
    shell.saveState.addEventListener("click", () => this.sessions?.saveDialog());
    document.addEventListener("preferences-changed", () => this.render());
  }
  run(action: () => Promise<unknown>) {
    void action().catch((cause: unknown) => this.report(cause));
  }
  report(cause: unknown) {
    if (cause instanceof DOMException && cause.name === "AbortError") return;
    this.notice(cause instanceof Error ? cause.message : "작업을 완료하지 못했습니다.");
  }
  notice(text: string) {
    document.querySelector(".notice:not(.update-banner)")?.remove();
    clearTimeout(this.noticeTimer);
    const notice = element("div", "notice", text);
    notice.setAttribute("role", "status");
    appendNotice(notice);
    this.noticeTimer = setTimeout(() => notice.remove(), 6500);
  }
  async canLeave(): Promise<boolean> {
    const saved = await this.sessions?.flush();
    if (saved === false) {
      this.sessions?.saveDialog();
      return false;
    }
    return true;
  }
  async setVault(vault: Vault) {
    const token = ++this.generation;
    const release = this.sessions?.hold() ?? (() => undefined);
    try {
      if (!(await this.canLeave())) {
        vault.close();
        return;
      }
      const revisions = this.sessions?.revisions() ?? new Map<string, number>();
      this.notice("폴더를 로컬에서 읽고 있습니다…");
      let notes: Map<string, Note>;
      let skipped: number;
      try {
        ({ notes, skipped } = await readWorkspaceNotes(vault));
      } catch (cause: unknown) {
        vault.close();
        throw cause;
      }
      if (token !== this.generation) {
        vault.close();
        return;
      }
      if (this.sessions?.changedSince(revisions)) {
        vault.close();
        this.notice("열려 있는 노트에 새 변경 내용이 있어 폴더를 바꾸지 않았습니다.");
        return;
      }
      this.sessions?.destroy();
      this.panes.reset();
      this.vault?.close();
      this.vault = vault;
      this.notes.clear();
      for (const [path, note] of notes) this.notes.set(path, note);
      this.sessions = new Sessions({
        vault,
        parent: this.shell.documents,
        onChange: (path, content) => this.changed(path, content),
        onStatus: () => this.renderStatus(),
        onLink: (target, kind) => this.run(() => this.follow(target, kind)),
        onFocus: (id) => this.panes.onEditorFocus(id),
      });
      this.shell.search.value = "";
      this.shell.vaultName.textContent = vault.name;
      this.shell.vaultName.title = vault.name;
      this.shell.welcome.hidden = true;
      this.render();
      const restored = await this.panes.restore();
      if (token !== this.generation) return;
      if (!restored) {
        const first = initialWorkspaceNote(notes);
        if (first) await this.open(first.path);
        else this.showEmpty();
      }
      if (token !== this.generation) return;
      this.notice(
        (vault.kind === "folder"
          ? "로컬 폴더를 열었습니다. 변경 내용은 원본 파일에 자동 저장됩니다."
          : vault.kind === "demo"
            ? "예제 공간입니다. 변경 내용은 이 브라우저에만 저장됩니다."
            : "읽기 전용으로 열었습니다. 원본 폴더 자동 저장은 Chrome 또는 Edge를 사용하세요.") +
          skippedNotice(skipped, vault.hidden),
      );
    } finally {
      release();
    }
  }
  changed(path: string, content: string) {
    this.notes.set(path, { path, content });
    this.renderStatus();
    clearTimeout(this.indexTimer);
    this.indexTimer = setTimeout(() => {
      this.render();
      this.panes.updateGraphs();
    }, 220);
  }
  graphData() {
    return buildGraph([...this.notes.values()], this.vault?.entries ?? []);
  }
  version() {
    return this.generation;
  }
  async open(path: string, group?: string) {
    if (this.vault?.entries.find((entry) => entry.path === path)?.kind === "asset") {
      await showAttachment(this.vault, path);
      return;
    }
    await this.panes.open(path, group);
  }
  async follow(target: string, kind?: NoteLink["kind"]) {
    await followWorkspaceLink(this, target, kind);
  }
  createNote(initial = "새 노트.md") {
    createWorkspaceNote(this, initial);
  }
  async daily() {
    if (!this.vault) {
      this.notice("먼저 폴더를 여세요.");
      return;
    }
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const path = `daily/${date}.md`;
    if (this.notes.has(path)) await this.open(path);
    else this.createNote(path);
  }
  async refresh() {
    await refreshWorkspace(this);
  }
  showGraph(local = false) {
    this.panes.showGraph(local);
  }
  mode(mode?: EditorMode) {
    const current = this.sessions?.mode ?? "live";
    const next =
      mode ?? (current === "live" ? "source" : current === "source" ? "reading" : "live");
    const tab = this.panes.layout.activeTab();
    if (tab) this.panes.mode(tab.id, next);
  }
  async closeTab() {
    await this.panes.close();
  }
  nextTab(direction: number) {
    this.panes.next(direction);
  }
  showEmpty() {
    this.render();
  }
  editor() {
    const tab = this.panes.layout.activeTab();
    return tab?.kind === "note" ? this.sessions?.views.get(tab.id)?.editor : undefined;
  }
  render() {
    renderWorkspace(this);
  }
  renderStatus() {
    const s = this.sessions?.current();
    const state = s?.status.kind ?? "saved";
    this.shell.saveState.dataset["state"] = state;
    const labels = {
      saved: "✓ 로컬에 저장됨",
      pending: "변경 내용 저장 대기",
      saving: "저장 중…",
      conflict: "충돌 · 확인 필요",
      error: "저장 실패 · 확인 필요",
    } as const;
    this.shell.saveState.textContent =
      this.vault?.kind === "readonly"
        ? "읽기 전용 · 원본 저장 불가"
        : this.vault?.kind === "demo" && state === "saved"
          ? "✓ 예제 · 브라우저에 저장됨"
          : s
            ? labels[state]
            : this.vault
              ? "로컬 폴더 준비됨"
              : "폴더를 열어 시작하세요";
    const content = s?.editor.getContent() ?? "";
    const chars = [...content].length;
    const words = content.trim() ? content.trim().split(/\s+/).length : 0;
    this.shell.metrics.textContent = `${this.notes.size}개 노트 · ${words}단어 · ${chars}자`;
  }
}
