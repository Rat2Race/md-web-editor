import type { FileSnapshot, WritableVault } from "../core/types";
import { VaultError } from "./errors";
import { type Draft, discardSpecificDraft, draftSessionId, writeDraft } from "./journal";

export type SaveStatus = {
  readonly kind: "saved" | "pending" | "saving" | "conflict" | "error";
  readonly message?: string;
  readonly current?: FileSnapshot;
};

export type AutosaveOptions = {
  readonly vault: WritableVault;
  readonly path: string;
  readonly snapshot: FileSnapshot;
  readonly onStatus: (status: SaveStatus) => void;
};

export interface Autosave {
  edit(content: string): void;
  flush(): Promise<boolean>;
  getContent(): string;
  getSnapshot(): FileSnapshot;
  dispose(): void;
}

const debounceMs = 500;

export function createAutosave(options: AutosaveOptions): Autosave {
  return new AutosaveController(options);
}

class AutosaveController implements Autosave {
  private content: string;
  private current: FileSnapshot;
  private revision = 0;
  private savedRevision = 0;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private journalTask: Promise<void> = Promise.resolve();
  private flushTask: Promise<boolean> | undefined;

  constructor(private readonly options: AutosaveOptions) {
    this.content = options.snapshot.content;
    this.current = options.snapshot;
  }

  edit(content: string): void {
    if (this.disposed) return;
    this.content = content;
    this.revision += 1;
    const draft = this.draft();
    this.journalTask = this.journalTask
      .catch(() => undefined)
      .then(async () => {
        await writeDraft(draft);
      });
    this.emit({ kind: "pending" });
    this.schedule();
  }

  async flush(): Promise<boolean> {
    if (this.disposed) return false;
    if (this.flushTask) return this.flushTask;
    this.clearTimer();
    this.flushTask = this.drain();
    try {
      return await this.flushTask;
    } finally {
      this.flushTask = undefined;
    }
  }

  getContent(): string {
    return this.content;
  }
  getSnapshot(): FileSnapshot {
    return this.current;
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
  }

  private async drain(): Promise<boolean> {
    while (this.revision !== this.savedRevision) {
      if (!(await this.saveRevision())) return false;
    }
    return !this.disposed;
  }

  private async saveRevision(): Promise<boolean> {
    const targetRevision = this.revision;
    const draft = this.draft();
    try {
      await this.journalTask;
    } catch (error) {
      this.emit(
        error instanceof Error
          ? { kind: "error", message: error.message }
          : { kind: "error", message: "The recovery draft could not be stored." },
      );
      return false;
    }
    if (this.disposed) return false;
    this.emit({ kind: "saving" });
    try {
      const saved = await this.options.vault.write(
        this.options.path,
        draft.content,
        this.current.fingerprint,
      );
      this.current = saved;
      this.savedRevision = targetRevision;
      if (this.revision === targetRevision) {
        await discardSpecificDraft(draft);
        this.emit({ kind: "saved" });
      } else {
        const retained = this.draft();
        this.journalTask = this.journalTask
          .catch(() => undefined)
          .then(async () => {
            await writeDraft(retained);
          });
        await this.journalTask;
        this.emit({ kind: "pending" });
      }
      return true;
    } catch (error) {
      if (error instanceof VaultError && error.code === "conflict") {
        this.emit(
          error.current
            ? { kind: "conflict", message: error.message, current: error.current }
            : { kind: "conflict", message: error.message },
        );
      } else if (error instanceof Error) this.emit({ kind: "error", message: error.message });
      else this.emit({ kind: "error", message: "The draft remains unsaved." });
      return false;
    }
  }

  private draft(): Draft {
    return {
      vaultId: this.options.vault.id,
      path: this.options.path,
      content: this.content,
      baseFingerprint: this.current.fingerprint,
      revision: this.revision,
      savedAt: Date.now(),
      sessionId: draftSessionId,
    };
  }

  private schedule(): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      void this.flush();
    }, debounceMs);
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private emit(status: SaveStatus): void {
    if (!this.disposed) this.options.onStatus(status);
  }
}
