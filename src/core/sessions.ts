import { type LoadedDocument, loadDocument } from "./session-load";
import type { Session, SessionOptions } from "./session-model";
import { SessionPersistence } from "./session-persistence";
import { showSaveDialog } from "./session-save-dialog";
import { changedSince, flushSessions, hasPending, revisionsOf } from "./session-state";
import { createSessionView, destroySessionView, type SessionView } from "./session-view";
import type { EditorMode, NoteLink } from "./types";

export type { Session, SessionOptions } from "./session-model";
export type { SessionView } from "./session-view";

export class SessionDestroyedError extends Error {}
class SessionCloseError extends Error {}

export class Sessions {
  readonly items = new Map<string, Session>();
  readonly views = new Map<string, SessionView>();
  active = "";
  activeView = "";
  mode: EditorMode = "live";
  private readonly loads = new Map<string, Promise<LoadedDocument | undefined>>();
  private holds = 0;
  private destroyed = false;
  private readonly persistence: SessionPersistence;

  constructor(readonly options: SessionOptions) {
    this.persistence = new SessionPersistence({
      options,
      items: this.items,
      views: this.views,
      hold: () => this.hold(),
    });
  }

  current(): Session | undefined {
    return this.items.get(this.active);
  }

  revisions(): ReadonlyMap<string, number> {
    return revisionsOf(this.items);
  }

  changedSince(revisions: ReadonlyMap<string, number>): boolean {
    return changedSince(this.items, revisions);
  }

  hold(): () => void {
    this.holds += 1;
    this.setViewsReadonly(true);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holds -= 1;
      if (this.holds === 0) this.setViewsReadonly(this.options.vault.kind === "readonly");
    };
  }

  async ensureView(path: string, id: string): Promise<SessionView> {
    this.assertAlive();
    const existing = this.views.get(id);
    if (existing?.path === path) return existing;
    if (existing && !(await this.closeView(id))) throw new SessionCloseError(id);
    let session = this.items.get(path);
    if (!session) {
      const loaded = await this.load(path);
      this.assertAlive();
      session = this.items.get(path) ?? this.createSession(path, id, loaded);
      if (this.views.has(id)) return this.view(id);
    }
    return this.addView(session, id);
  }

  activateView(id: string): boolean {
    const view = this.views.get(id);
    if (!view) return false;
    const session = this.items.get(view.path);
    if (!session) return false;
    session.editor = view.editor;
    session.host = view.host;
    this.active = view.path;
    this.activeView = id;
    this.mode = view.mode;
    return true;
  }

  async closeView(id: string): Promise<boolean> {
    const view = this.views.get(id);
    if (!view) return true;
    const session = this.items.get(view.path);
    if (!session) return true;
    const related = this.viewsFor(session.path);
    if (related.length === 1) return this.close(session.path);
    const wasActive = this.activeView === id;
    this.removeView(view);
    if (session.editor === view.editor)
      this.useRepresentative(
        session,
        related.find((x) => x.id !== id),
      );
    if (wasActive) this.activateView(this.viewAfterClose(related, id).id);
    return true;
  }

  async flush(): Promise<boolean> {
    return flushSessions(this.items);
  }

  async close(path: string): Promise<boolean> {
    const session = this.items.get(path);
    if (!session) return true;
    if (!session.save && session.status.kind !== "saved") return false;
    if (session.save && !(await session.save.flush())) return false;
    for (const view of this.viewsFor(path)) this.removeView(view);
    session.save?.dispose();
    this.items.delete(path);
    if (this.active === path) this.active = "";
    return true;
  }

  setMode(mode: EditorMode): void {
    const view = this.views.get(this.activeView);
    if (!view) return;
    view.mode = mode;
    view.editor.setMode(mode);
    this.mode = mode;
  }

  pending(): boolean {
    return hasPending(this.items);
  }

  async reload(path: string): Promise<boolean | undefined> {
    return this.persistence.reload(path);
  }

  async acceptLocal(session: Session): Promise<boolean> {
    return this.persistence.acceptLocal(session);
  }

  saveDialog(): void {
    const session =
      [...this.items.values()].find(
        (x) => x.status.kind === "conflict" || x.status.kind === "error",
      ) ?? this.current();
    showSaveDialog(session, {
      reload: (path) => this.reload(path),
      acceptLocal: (x) => this.acceptLocal(x),
    });
  }

  destroy(): void {
    this.destroyed = true;
    for (const view of [...this.views.values()]) this.removeView(view);
    for (const session of this.items.values()) session.save?.dispose();
    this.items.clear();
    this.loads.clear();
    this.active = "";
    this.activeView = "";
  }

  private async load(path: string): Promise<LoadedDocument> {
    const pending = this.loads.get(path);
    if (pending) return this.requireLoaded(await pending);
    const task = loadDocument({ vault: this.options.vault, path, isAlive: () => !this.destroyed });
    this.loads.set(path, task);
    void task.then(
      () => this.clearLoad(path, task),
      () => this.clearLoad(path, task),
    );
    return this.requireLoaded(await task);
  }

  private createSession(path: string, id: string, loaded: LoadedDocument): Session {
    const view = this.makeView(path, id, loaded.content);
    const session: Session = {
      path,
      editor: view.editor,
      host: view.host,
      save: undefined,
      status: loaded.status,
      snapshot: loaded.snapshot,
      revision: 0,
      recovery: loaded.recovery,
      content: loaded.snapshot.content,
    };
    this.items.set(path, session);
    this.persistence.attach(session, loaded.saveSnapshot);
    if (loaded.content !== loaded.snapshot.content) this.persistence.change(id, loaded.content);
    if (loaded.status.kind === "conflict") this.options.onStatus();
    return session;
  }

  private addView(session: Session, id: string): SessionView {
    return this.makeView(session.path, id, session.content);
  }

  private makeView(path: string, id: string, content: string): SessionView {
    const view = createSessionView({
      id,
      path,
      parent: this.options.parent,
      content,
      mode: this.mode,
      readonly: this.holds > 0 || this.options.vault.kind === "readonly",
      vault: this.options.vault,
      onChange: (viewId, value) => this.persistence.change(viewId, value),
      onLink: (viewId, target, kind) => this.followLink(viewId, target, kind),
      onFocus: (viewId) => this.focused(viewId),
    });
    this.views.set(id, view);
    return view;
  }

  private focused(id: string): void {
    if (this.activateView(id)) this.options.onFocus?.(id);
  }

  private followLink(id: string, target: string, kind?: NoteLink["kind"]): void {
    if (this.activateView(id)) this.options.onFocus?.(id);
    this.options.onLink(target, kind);
  }

  private removeView(view: SessionView): void {
    this.views.delete(view.id);
    destroySessionView(view);
    if (this.activeView === view.id) this.activeView = "";
  }

  private viewsFor(path: string): SessionView[] {
    return [...this.views.values()].filter((view) => view.path === path);
  }

  private useRepresentative(session: Session, view: SessionView | undefined): void {
    if (!view) return;
    session.editor = view.editor;
    session.host = view.host;
  }

  private viewAfterClose(views: readonly SessionView[], id: string): SessionView {
    const view = views.find((candidate) => candidate.id !== id);
    if (!view) throw new SessionCloseError(id);
    return view;
  }

  private view(id: string): SessionView {
    const view = this.views.get(id);
    if (!view) throw new SessionDestroyedError();
    return view;
  }

  private clearLoad(path: string, task: Promise<LoadedDocument | undefined>): void {
    if (this.loads.get(path) === task) this.loads.delete(path);
  }

  private requireLoaded(loaded: LoadedDocument | undefined): LoadedDocument {
    if (!loaded) throw new SessionDestroyedError();
    return loaded;
  }

  private assertAlive(): void {
    if (this.destroyed) throw new SessionDestroyedError();
  }

  private setViewsReadonly(value: boolean): void {
    for (const view of this.views.values()) view.editor.setReadonly(value);
  }
}
