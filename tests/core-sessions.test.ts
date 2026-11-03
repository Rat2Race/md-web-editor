// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EditorOptions,
  FileSnapshot,
  NoteEditor,
  VaultEntry,
  WritableVault,
} from "../src/core/types";

const harness = vi.hoisted(() => {
  const editors = new Map<string, FakeEditor>();
  const dialogs: HTMLDialogElement[] = [];
  const bodies: HTMLDivElement[] = [];
  return { editors, dialogs, bodies };
});

const autosaves = vi.hoisted(() => ({
  edits: [] as { readonly content: string; readonly snapshot: FileSnapshot }[],
  flushes: [] as { readonly content: string; readonly snapshot: FileSnapshot }[],
}));

class FakeEditor implements NoteEditor {
  content: string;
  readonly: boolean;
  constructor(readonly options: EditorOptions) {
    this.content = options.content;
    this.readonly = options.readonly;
  }
  setDocument(content: string, _path: string): void {
    this.content = content;
  }
  syncContent(content: string): void {
    this.content = content;
  }
  setMode(): void {}
  setReadonly(value: boolean): void {
    this.readonly = value;
  }
  getContent(): string {
    return this.content;
  }
  focus(): void {}
  goToLine(): void {}
  format(): void {}
  undo(): void {}
  redo(): void {}
  find(): void {}
  destroy(): void {}
  type(content: string): void {
    this.content = content;
    this.options.onChange(content);
  }
}

vi.mock("../src/editor/editor", () => ({
  createEditor: (options: EditorOptions) => {
    const editor = new FakeEditor(options);
    harness.editors.set(options.path, editor);
    return editor;
  },
}));

vi.mock("../src/storage/autosave", () => ({
  createAutosave: (options: {
    readonly snapshot: FileSnapshot;
    readonly onStatus: (status: { readonly kind: "saved" }) => void;
  }) => {
    let current = options.snapshot.content;
    return {
      edit: (content: string) => {
        current = content;
        autosaves.edits.push({ content, snapshot: options.snapshot });
      },
      flush: async () => {
        autosaves.flushes.push({ content: current, snapshot: options.snapshot });
        options.onStatus({ kind: "saved" });
        return true;
      },
      getContent: () => "",
      getSnapshot: () => ({ content: "", fingerprint: "" }),
      dispose: () => undefined,
    };
  },
}));

const journal = vi.hoisted(() => ({
  readDraft: vi.fn(),
  discardDraft: vi.fn(),
  discardSpecificDraft: vi.fn(),
}));

vi.mock("../src/storage/journal", () => journal);

const dialogs = vi.hoisted(() => ({
  openDialog: vi.fn(() => {
    const dialog = document.createElement("dialog");
    Object.defineProperty(dialog, "close", {
      value: () => dialog.dispatchEvent(new Event("close")),
    });
    harness.dialogs.push(dialog);
    const body = document.createElement("div");
    harness.bodies.push(body);
    return { dialog, body };
  }),
}));

vi.mock("../src/ui/dialog", () => dialogs);

import { Sessions } from "../src/core/sessions";

function snapshot(content: string): FileSnapshot {
  return { content, fingerprint: `fingerprint:${content}` };
}

class BarrierVault implements WritableVault {
  readonly kind = "demo" as const;
  readonly name = "test vault";
  readonly entries: readonly VaultEntry[];
  private readonly values = new Map<string, FileSnapshot>();
  private readonly reads = new Map<string, (() => void)[]>();
  private readonly waitForRead = new Set<string>();

  constructor(
    readonly id: string,
    values: Readonly<Record<string, string>>,
  ) {
    this.entries = Object.keys(values).map((path) => ({ path, kind: "note", modified: 1 }));
    for (const [path, content] of Object.entries(values)) this.values.set(path, snapshot(content));
  }

  pauseNextRead(path: string): void {
    this.waitForRead.add(path);
  }
  releaseRead(path: string): void {
    this.reads.get(path)?.shift()?.();
  }
  waiting(path: string): number {
    return this.reads.get(path)?.length ?? 0;
  }
  async read(path: string): Promise<FileSnapshot> {
    if (this.waitForRead.delete(path))
      await new Promise<void>((resolve) => {
        const waiting = this.reads.get(path) ?? [];
        waiting.push(resolve);
        this.reads.set(path, waiting);
      });
    const value = this.values.get(path);
    if (!value) throw new Error(`Missing ${path}`);
    return value;
  }
  async asset(): Promise<Blob | undefined> {
    return undefined;
  }
  async refresh(): Promise<void> {}
  close(): void {}
  async write(_path: string, content: string): Promise<FileSnapshot> {
    return snapshot(content);
  }
  async create(_path: string, content: string): Promise<FileSnapshot> {
    return snapshot(content);
  }
}

function createSessions(vault: WritableVault): Sessions {
  return new Sessions({
    vault,
    parent: document.createElement("main"),
    onChange: () => undefined,
    onStatus: () => undefined,
    onLink: () => undefined,
  });
}

async function openView(sessions: Sessions, path: string): Promise<boolean> {
  await sessions.ensureView(path, path);
  return sessions.activateView(path);
}

describe("Sessions async safety", () => {
  beforeEach(() => {
    harness.editors.clear();
    harness.dialogs.length = 0;
    harness.bodies.length = 0;
    autosaves.edits.length = 0;
    autosaves.flushes.length = 0;
    vi.clearAllMocks();
  });

  it("keeps a new editor change when the disk read for reload finishes later", async () => {
    const vault = new BarrierVault("reload", { "one.md": "disk base" });
    const sessions = createSessions(vault);
    journal.readDraft.mockResolvedValue(undefined);
    await openView(sessions, "one.md");
    vault.pauseNextRead("one.md");

    const reload = sessions.reload("one.md");
    await vi.waitFor(() => expect(vault.waiting("one.md")).toBe(1));
    harness.editors.get("one.md")?.type("new local text");
    vault.releaseRead("one.md");

    await expect(reload).resolves.toBe(false);
    expect(harness.editors.get("one.md")?.getContent()).toBe("new local text");
  });

  it("retains a recovery draft when the recovery dialog is dismissed", async () => {
    const vault = new BarrierVault("recovery", { "one.md": "disk base" });
    const sessions = createSessions(vault);
    journal.readDraft.mockResolvedValue({
      vaultId: vault.id,
      path: "one.md",
      content: "unsaved draft",
      baseFingerprint: "fingerprint:disk base",
      revision: 1,
      savedAt: 1,
    });

    const opening = openView(sessions, "one.md");
    await vi.waitFor(() => expect(harness.dialogs).toHaveLength(1));
    harness.dialogs.at(-1)?.close();
    await expect(opening).resolves.toBe(true);

    expect(journal.discardSpecificDraft).not.toHaveBeenCalled();
  });

  it("discards the selected matching recovery draft after it saves", async () => {
    const vault = new BarrierVault("matching-recovery", { "one.md": "disk base" });
    const sessions = createSessions(vault);
    const draft = {
      vaultId: vault.id,
      path: "one.md",
      content: "recovered draft",
      baseFingerprint: "fingerprint:disk base",
      revision: 1,
      savedAt: 1,
    };
    journal.readDraft.mockResolvedValue(draft);

    const opening = openView(sessions, "one.md");
    await vi.waitFor(() => expect(harness.bodies).toHaveLength(1));
    [...(harness.bodies[0]?.querySelectorAll("button") ?? [])]
      .find((button) => button.textContent === "복구본 열기")
      ?.click();
    await expect(opening).resolves.toBe(true);
    expect(sessions.current()?.recovery).toEqual(draft);
    expect(autosaves.edits).toContainEqual({
      content: "recovered draft",
      snapshot: snapshot("disk base"),
    });

    await expect(sessions.flush()).resolves.toBe(true);
    expect(autosaves.flushes).toContainEqual({
      content: "recovered draft",
      snapshot: snapshot("disk base"),
    });
    await vi.waitFor(() => expect(journal.discardSpecificDraft).toHaveBeenCalledWith(draft));
  });

  it("holds existing editors read-only until a vault operation releases them", async () => {
    const vault = new BarrierVault("hold", { "one.md": "disk base" });
    const sessions = createSessions(vault);
    journal.readDraft.mockResolvedValue(undefined);
    await openView(sessions, "one.md");

    const release = sessions.hold();
    expect(harness.editors.get("one.md")?.readonly).toBe(true);
    release();

    expect(harness.editors.get("one.md")?.readonly).toBe(false);
  });

  it("flushes every open tab even when an earlier save fails", async () => {
    const vault = new BarrierVault("flush", { "one.md": "one", "two.md": "two" });
    const sessions = createSessions(vault);
    journal.readDraft.mockResolvedValue(undefined);
    await openView(sessions, "one.md");
    await openView(sessions, "two.md");
    const first = sessions.items.get("one.md")?.save;
    const second = sessions.items.get("two.md")?.save;
    const firstFlush = vi.fn(async () => false);
    const secondFlush = vi.fn(async () => true);
    if (!first || !second) throw new Error("Expected both autosaves to exist.");
    first.flush = firstFlush;
    second.flush = secondFlush;

    await expect(sessions.flush()).resolves.toBe(false);

    expect(firstFlush).toHaveBeenCalledOnce();
    expect(secondFlush).toHaveBeenCalledOnce();
  });

  it("forwards the parsed link kind from the editor to the workspace callback", async () => {
    const vault = new BarrierVault("link", { "one.md": "disk base" });
    const onLink = vi.fn();
    const sessions = new Sessions({
      vault,
      parent: document.createElement("main"),
      onChange: () => undefined,
      onStatus: () => undefined,
      onLink,
    });
    journal.readDraft.mockResolvedValue(undefined);
    await openView(sessions, "one.md");

    harness.editors.get("one.md")?.options.onLink("other.md", "markdown");

    expect(onLink).toHaveBeenCalledWith("other.md", "markdown");
  });

  it("requires review before a recovered draft can overwrite a changed disk file", async () => {
    const vault = new BarrierVault("recovery-conflict", { "one.md": "new disk text" });
    const sessions = createSessions(vault);
    journal.readDraft.mockResolvedValue({
      vaultId: vault.id,
      path: "one.md",
      content: "local recovery",
      baseFingerprint: "fingerprint:old disk text",
      revision: 1,
      savedAt: 1,
    });

    const opening = openView(sessions, "one.md");
    await vi.waitFor(() => expect(harness.bodies).toHaveLength(1));
    const recover = [...(harness.bodies[0]?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "복구본 열기",
    );
    recover?.click();
    await expect(opening).resolves.toBe(true);

    expect(sessions.current()?.editor.getContent()).toBe("local recovery");
    expect(sessions.current()?.status.kind).toBe("conflict");
    harness.editors.get("one.md")?.type("latest recovery");
    expect(autosaves.edits.at(-1)).toEqual({
      content: "latest recovery",
      snapshot: { content: "new disk text", fingerprint: "fingerprint:old disk text" },
    });
    await expect(sessions.reload("one.md")).resolves.toBe(true);
    expect(journal.discardSpecificDraft).toHaveBeenCalledWith(
      expect.objectContaining({ content: "local recovery" }),
    );
  });
});
