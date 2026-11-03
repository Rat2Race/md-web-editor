// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSnapshot, NoteEditor, VaultEntry, WritableVault } from "../src/core/types";

vi.mock("../src/editor/editor", () => ({
  createEditor: (): NoteEditor => ({
    setDocument: () => undefined,
    syncContent: () => undefined,
    setMode: () => undefined,
    setReadonly: () => undefined,
    getContent: () => "",
    focus: () => undefined,
    goToLine: () => undefined,
    format: () => undefined,
    undo: () => undefined,
    redo: () => undefined,
    find: () => undefined,
    destroy: () => undefined,
  }),
}));

vi.mock("../src/ui/workspace-view", () => ({ renderWorkspace: () => undefined }));

import { Sessions } from "../src/core/sessions";
import { Workspace } from "../src/core/workspace";
import { useMemoryStoreForTesting } from "../src/storage/browser-store";
import { VaultError } from "../src/storage/errors";
import { createShell } from "../src/ui/shell";

class DelayedReadVault implements WritableVault {
  readonly kind = "demo" as const;
  readonly name = "test vault";
  readonly entries: readonly VaultEntry[] = [
    { path: "one.md", kind: "note", modified: 1 },
    { path: "two.md", kind: "note", modified: 1 },
  ];
  private release: (() => void) | undefined;

  async read(path: string): Promise<FileSnapshot> {
    if (path === "one.md") await new Promise<void>((resolve) => (this.release = resolve));
    return { content: path, fingerprint: path };
  }
  resolveFirstRead(): void {
    this.release?.();
  }
  firstReadPending(): boolean {
    return this.release !== undefined;
  }
  async asset(): Promise<Blob | undefined> {
    return undefined;
  }
  async refresh(): Promise<void> {}
  close(): void {}
  async write(_path: string, content: string): Promise<FileSnapshot> {
    return { content, fingerprint: content };
  }
  async create(_path: string, content: string): Promise<FileSnapshot> {
    return { content, fingerprint: content };
  }
  constructor(readonly id: string) {}
}

let restoreStore: (() => void) | undefined;

beforeEach(() => {
  restoreStore = useMemoryStoreForTesting();
});

afterEach(() => {
  restoreStore?.();
  restoreStore = undefined;
});

describe("Workspace open", () => {
  it("does not show a save dialog for an open request superseded by a newer tab", async () => {
    const workspace = new Workspace(createShell(document.body));
    const vault = new DelayedReadVault("workspace-open");
    const sessions = new Sessions({
      vault,
      parent: workspace.shell.documents,
      onChange: () => undefined,
      onStatus: () => undefined,
      onLink: () => undefined,
    });
    workspace.sessions = sessions;
    const saveDialog = vi.spyOn(sessions, "saveDialog");

    const first = workspace.open("one.md");
    await vi.waitFor(() => expect(vault.firstReadPending()).toBe(true));
    const second = workspace.open("two.md");
    await expect(second).resolves.toBeUndefined();
    vault.resolveFirstRead();
    await expect(first).resolves.toBeUndefined();

    expect(sessions.active).toBe("two.md");
    expect(saveDialog).not.toHaveBeenCalled();
  });
});

class FailingReadVault extends DelayedReadVault {
  constructor(private readonly failure: Error) {
    super("failing-read");
  }
  override async read(path: string): Promise<FileSnapshot> {
    if (path === "two.md") throw this.failure;
    return { content: path, fingerprint: path };
  }
}

describe("Workspace vault loading", () => {
  it("opens the vault without notes it cannot read and says how many it skipped", async () => {
    const workspace = new Workspace(createShell(document.body));
    await workspace.setVault(
      new FailingReadVault(new VaultError("io", "Note two.md exceeds the 10 MiB limit.")),
    );
    expect([...workspace.notes.keys()]).toEqual(["one.md"]);
    expect(document.querySelector(".notice")?.textContent).toContain("읽을 수 없는 노트 1개");
  });

  it("still fails the open on errors that are not vault errors", async () => {
    const workspace = new Workspace(createShell(document.body));
    await expect(workspace.setVault(new FailingReadVault(new TypeError("bug")))).rejects.toThrow(
      "bug",
    );
  });
});
