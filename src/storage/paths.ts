import { VaultError } from "./errors";

const invalidName = /[<>:"\\/|?*]/u;
const reservedNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
const sensitiveDirectories = new Set([".git", ".hg", ".svn"]);
const noteExtension = /\.m(?:d|arkdown)$/iu;
const imageExtension = /\.(?:png|jpe?g|gif|webp|avif)$/iu;

export function normalizePath(input: string): string {
  const path = input.replaceAll("\\", "/");
  if (path.length === 0 || path.startsWith("/") || path.includes("//")) {
    throw new VaultError("invalid-path", "Use a non-empty path inside the vault.");
  }
  const parts = path.split("/");
  if (parts.some((part) => !isSafePart(part))) {
    throw new VaultError("invalid-path", "The path contains an invalid or protected name.");
  }
  return parts.join("/");
}

/** Dot-names (.git, .obsidian, .DS_Store) are hidden by convention, so skipping them is not news. */
export function conventionallyHidden(path: string): boolean {
  return path.split("/").some((part) => part.startsWith("."));
}

export function isNotePath(path: string): boolean {
  return noteExtension.test(path);
}

export function isImagePath(path: string): boolean {
  return imageExtension.test(path);
}

export function requireNotePath(path: string): string {
  const normalized = normalizePath(path);
  if (!isNotePath(normalized)) {
    throw new VaultError("invalid-path", "Notes must use a .md or .markdown extension.");
  }
  return normalized;
}

export function importPath(relativePath: string): string | undefined {
  const parts = relativePath.replaceAll("\\", "/").split("/");
  const content = parts.length > 1 ? parts.slice(1) : parts;
  if (content.some((part) => sensitiveDirectories.has(part.toLowerCase()))) return undefined;
  try {
    return normalizePath(content.join("/"));
  } catch (error) {
    if (error instanceof VaultError && error.code === "invalid-path") return undefined;
    throw error;
  }
}

function isSafePart(part: string): boolean {
  return (
    part.length > 0 &&
    part !== "." &&
    part !== ".." &&
    !part.startsWith(".") &&
    !sensitiveDirectories.has(part.toLowerCase()) &&
    !invalidName.test(part) &&
    ![...part].some((character) => (character.codePointAt(0) ?? 0) < 32) &&
    !/[. ]$/u.test(part) &&
    !reservedNames.test(part)
  );
}
