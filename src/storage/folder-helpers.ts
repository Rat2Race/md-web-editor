import type { VaultEntry } from "../core/types";
import { listStored, writeStored } from "./browser-store";
import { VaultError, vaultError } from "./errors";
import { conventionallyHidden, isNotePath, normalizePath } from "./paths";

const queues = new Map<string, Promise<unknown>>();

export async function folderIdentity(handle: FileSystemDirectoryHandle): Promise<string> {
  return lock("folder-identity", async () => {
    for (const value of await listStored("vaults", "folder:")) {
      const stored = parseStoredFolder(value);
      if (stored && (await handle.isSameEntry(stored.handle))) return stored.id;
    }
    const id = `folder:${crypto.randomUUID()}`;
    await writeStored("vaults", id, { id, handle });
    return id;
  });
}

export async function scanDirectory(
  root: FileSystemDirectoryHandle,
  prefix = "",
): Promise<{ readonly entries: readonly VaultEntry[]; readonly hidden: number }> {
  const entries: VaultEntry[] = [];
  let hidden = 0;
  for await (const handle of root.values()) {
    const path = prefix ? `${prefix}/${handle.name}` : handle.name;
    try {
      normalizePath(path);
    } catch (error) {
      if (!(error instanceof VaultError && error.code === "invalid-path")) throw error;
      if (!conventionallyHidden(handle.name)) hidden += 1;
      continue;
    }
    if (handle.kind === "directory") {
      const child = await scanDirectory(handle, path);
      entries.push(...child.entries);
      hidden += child.hidden;
    }
    if (handle.kind === "file") {
      entries.push({
        path,
        kind: isNotePath(path) ? "note" : "asset",
        modified: await lastModified(handle),
      });
    }
  }
  return { entries: entries.sort((left, right) => left.path.localeCompare(right.path)), hidden };
}

// An unreadable file stays listed; reading it later reports the failure for that file only.
async function lastModified(handle: FileSystemFileHandle): Promise<number> {
  try {
    return (await handle.getFile()).lastModified;
  } catch (error) {
    if (error instanceof DOMException) return 0;
    throw error;
  }
}

export async function readFile(root: FileSystemDirectoryHandle, path: string): Promise<File> {
  return (await fileHandle(root, path, false)).getFile();
}

export async function fileHandle(
  root: FileSystemDirectoryHandle,
  path: string,
  create: boolean,
): Promise<FileSystemFileHandle> {
  const parts = normalizePath(path).split("/");
  const name = parts.pop();
  if (!name) throw new VaultError("invalid-path", "A file name is required.");
  let directory = root;
  try {
    for (const part of parts) directory = await directory.getDirectoryHandle(part, { create });
    return await directory.getFileHandle(name, { create });
  } catch (error) {
    if (error instanceof VaultError) throw error;
    throw vaultError(error, "The requested file path is unavailable.");
  }
}

export async function lock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks)
    return navigator.locks.request(`md-web-editor:${key}`, operation);
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  queues.set(key, next);
  try {
    return await next;
  } finally {
    if (queues.get(key) === next) queues.delete(key);
  }
}

export async function validImage(file: File): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  if (file.type === "image/png") return matches(bytes, [137, 80, 78, 71, 13, 10, 26, 10]);
  if (file.type === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (file.type === "image/gif") return textAt(bytes, 0, 3) === "GIF";
  if (file.type === "image/webp")
    return textAt(bytes, 0, 4) === "RIFF" && textAt(bytes, 8, 4) === "WEBP";
  return (
    file.type === "image/avif" &&
    textAt(bytes, 4, 4) === "ftyp" &&
    textAt(bytes, 8, 4).includes("avif")
  );
}

export function parseDemo(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value) || !Object.values(value).every((note) => typeof note === "string"))
    return undefined;
  const notes: Record<string, string> = {};
  for (const [path, content] of Object.entries(value))
    if (typeof content === "string") notes[path] = content;
  return notes;
}

function parseStoredFolder(
  value: unknown,
): { readonly id: string; readonly handle: FileSystemDirectoryHandle } | undefined {
  if (!isFolderCandidate(value) || typeof value.id !== "string" || !isDirectoryHandle(value.handle))
    return undefined;
  return { id: value.id, handle: value.handle };
}

function isDirectoryHandle(value: unknown): value is FileSystemDirectoryHandle {
  return (
    typeof value === "object" &&
    value !== null &&
    "isSameEntry" in value &&
    typeof value.isSameEntry === "function"
  );
}

function matches(bytes: Uint8Array, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

function textAt(bytes: Uint8Array, start: number, length: number): string {
  return new TextDecoder().decode(bytes.slice(start, start + length));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFolderCandidate(
  value: unknown,
): value is { readonly id: unknown; readonly handle: unknown } {
  return typeof value === "object" && value !== null && "id" in value && "handle" in value;
}
