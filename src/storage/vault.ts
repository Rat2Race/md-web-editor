import type { FileSnapshot, Vault, VaultBase, VaultEntry, WritableVault } from "../core/types";
import { readStored, writeStored } from "./browser-store";
import { demoNotes } from "./demo-notes";
import { DemoVault } from "./demo-vault";
import { VaultError, vaultError } from "./errors";
import { assertSize, MAX_ASSET_BYTES, MAX_NOTE_BYTES, snapshot } from "./fingerprint";
import {
  fileHandle,
  folderIdentity,
  lock,
  parseDemo,
  readFile,
  scanDirectory,
  validImage,
} from "./folder-helpers";
import {
  conventionallyHidden,
  importPath,
  isImagePath,
  isNotePath,
  normalizePath,
  requireNotePath,
} from "./paths";

export { VaultError } from "./errors";

type Imported = { readonly file: File; readonly path: string; readonly kind: "note" | "asset" };

export async function openFolder(): Promise<Vault> {
  if (!("showDirectoryPicker" in globalThis)) {
    throw new VaultError("permission", "This browser cannot open writable folders.");
  }
  try {
    const handle = await globalThis.showDirectoryPicker({ mode: "readwrite" });
    const permission = await handle.requestPermission({ mode: "readwrite" });
    if (permission !== "granted")
      throw new VaultError("permission", "Write permission was not granted.");
    const vault = new FolderVault(await folderIdentity(handle), handle);
    await vault.refresh();
    return vault;
  } catch (error) {
    if (error instanceof VaultError) throw error;
    throw vaultError(error, "The folder could not be opened.");
  }
}

export async function importFolder(files: FileList): Promise<Vault> {
  const imported: Imported[] = [];
  const seen = new Set<string>();
  let hidden = 0;
  for (const file of Array.from(files)) {
    const relative = file.webkitRelativePath || file.name;
    const path = importPath(relative);
    if (!path) {
      if (!conventionallyHidden(relative)) hidden += 1;
      continue;
    }
    if (seen.has(path))
      throw new VaultError("exists", `The imported folder has two files named ${path}.`);
    seen.add(path);
    if (isNotePath(path)) {
      imported.push({ file, path, kind: "note" });
    } else imported.push({ file, path, kind: "asset" });
  }
  return new ImportVault(`import:${crypto.randomUUID()}`, imported, hidden);
}

export async function createDemoVault(): Promise<WritableVault> {
  const stored = parseDemo(await readStored("demo", "notes"));
  const notes = stored ?? demoNotes();
  if (!stored) await writeStored("demo", "notes", notes);
  return new DemoVault("demo:notebook", notes);
}

class FolderVault implements WritableVault {
  readonly kind = "folder" as const;
  readonly name: string;
  entries: readonly VaultEntry[] = [];
  hidden = 0;
  private closed = false;

  constructor(
    readonly id: string,
    private readonly root: FileSystemDirectoryHandle,
  ) {
    this.name = root.name;
  }

  async read(path: string): Promise<FileSnapshot> {
    this.ensureOpen();
    try {
      const file = await readFile(this.root, normalizePath(path));
      assertSize(file.size, isNotePath(path) ? MAX_NOTE_BYTES : MAX_ASSET_BYTES, path);
      return snapshot(await file.text());
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw vaultError(error, "The file could not be read.");
    }
  }

  async asset(path: string): Promise<Blob | undefined> {
    this.ensureOpen();
    const normalized = normalizePath(path);
    if (!isImagePath(normalized)) return undefined;
    try {
      const file = await readFile(this.root, normalized);
      assertSize(file.size, MAX_ASSET_BYTES, `Asset ${normalized}`);
      return (await validImage(file)) ? file : undefined;
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw vaultError(error, "The asset could not be read.");
    }
  }

  async file(path: string): Promise<File | undefined> {
    this.ensureOpen();
    const normalized = normalizePath(path);
    try {
      return await readFile(this.root, normalized);
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw vaultError(error, "The file could not be read.");
    }
  }

  async refresh(): Promise<void> {
    this.ensureOpen();
    const scan = await scanDirectory(this.root);
    this.entries = scan.entries;
    this.hidden = scan.hidden;
  }

  async write(path: string, content: string, expected: string): Promise<FileSnapshot> {
    this.ensureOpen();
    const normalized = requireNotePath(path);
    assertSize(new Blob([content]).size, MAX_NOTE_BYTES, `Note ${normalized}`);
    return lock(`${this.id}:${normalized}`, async () => {
      const current = await this.read(normalized);
      if (current.fingerprint !== expected) {
        throw new VaultError("conflict", "The file changed outside this editor.", current);
      }
      try {
        const handle = await fileHandle(this.root, normalized, false);
        const writable = await handle.createWritable();
        try {
          await writable.write(content);
          await writable.close();
        } catch (error) {
          await writable.abort();
          throw error;
        }
        const next = await snapshot(content);
        this.touch(normalized);
        return next;
      } catch (error) {
        if (error instanceof VaultError) throw error;
        throw vaultError(error, "The file could not be saved.");
      }
    });
  }

  async create(path: string, content: string): Promise<FileSnapshot> {
    this.ensureOpen();
    const normalized = requireNotePath(path);
    assertSize(new Blob([content]).size, MAX_NOTE_BYTES, `Note ${normalized}`);
    return lock(`${this.id}:${normalized}`, async () => {
      try {
        await fileHandle(this.root, normalized, false);
        throw new VaultError("exists", `A file already exists at ${normalized}.`);
      } catch (error) {
        if (!(error instanceof VaultError) || error.code !== "missing") throw error;
      }
      const handle = await fileHandle(this.root, normalized, true);
      const writable = await handle.createWritable();
      try {
        await writable.write(content);
        await writable.close();
      } catch (error) {
        await writable.abort();
        if (error instanceof VaultError) throw error;
        throw vaultError(error, "The new file could not be saved.");
      }
      const next = await snapshot(content);
      this.touch(normalized);
      return next;
    });
  }

  close(): void {
    this.closed = true;
  }

  private ensureOpen(): void {
    if (this.closed) throw new VaultError("io", "This vault is closed.");
  }

  private touch(path: string): void {
    const updated: VaultEntry = { path, kind: "note", modified: Date.now() };
    this.entries = [...this.entries.filter((entry) => entry.path !== path), updated].sort(
      (left, right) => left.path.localeCompare(right.path),
    );
  }
}

class ImportVault implements VaultBase {
  readonly kind = "readonly" as const;
  readonly name = "Imported folder";
  readonly entries: readonly VaultEntry[];

  constructor(
    readonly id: string,
    private readonly files: readonly Imported[],
    readonly hidden: number,
  ) {
    this.entries = files.map(({ path, kind, file }) => ({
      path,
      kind,
      modified: file.lastModified,
    }));
  }

  async read(path: string): Promise<FileSnapshot> {
    const file = this.find(path, "note").file;
    assertSize(file.size, MAX_NOTE_BYTES, `Note ${path}`);
    return snapshot(await file.text());
  }

  async asset(path: string): Promise<Blob | undefined> {
    const normalized = normalizePath(path);
    if (!isImagePath(normalized)) return undefined;
    const file = this.find(normalized, "asset").file;
    assertSize(file.size, MAX_ASSET_BYTES, `Asset ${normalized}`);
    return (await validImage(file)) ? file : undefined;
  }

  async file(path: string): Promise<File | undefined> {
    return this.find(normalizePath(path)).file;
  }

  async refresh(): Promise<void> {}
  close(): void {}

  private find(path: string, kind?: Imported["kind"]): Imported {
    const normalized = normalizePath(path);
    const item = this.files.find(
      (candidate) =>
        candidate.path === normalized && (kind === undefined || candidate.kind === kind),
    );
    if (!item) {
      const label = kind ?? "file";
      throw new VaultError("missing", `No ${label} exists at ${normalized}.`);
    }
    return item;
  }
}
