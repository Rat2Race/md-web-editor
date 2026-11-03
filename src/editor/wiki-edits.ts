import { parser } from "@lezer/markdown";
import { decoded, resolveLink, safePath } from "./markdown";
import { canonicalWikiLinkContent } from "./wiki-links";

export type WikiEditRange = { readonly from: number; readonly to: number };
export type WikiEdit = WikiEditRange & { readonly insert: string };
export type WikiEditOptions = {
  readonly content: string;
  readonly source: string;
  readonly paths: readonly string[];
  readonly changed: readonly WikiEditRange[];
};

type WikiMatch = WikiEditRange & { readonly value: string };

function filename(path: string): string {
  return path.replace(/^.*\//u, "");
}

function stem(path: string): string {
  const name = filename(path);
  return name.replace(/\.[^.]+$/u, "") || name;
}

function rawLink(value: string): { readonly target: string; readonly label: string | undefined } {
  const divider = value.indexOf("|");
  const target = (divider < 0 ? value : value.slice(0, divider)).trim();
  const label = divider < 0 ? undefined : value.slice(divider + 1).trim() || undefined;
  return { target, label };
}

function targetPath(target: string): string | undefined {
  const path = target.split("#", 1)[0] ?? "";
  const decodedPath = decoded(path);
  return decodedPath === undefined ? undefined : safePath(decodedPath);
}

function rootTarget(target: string): boolean {
  const path = target.split("#", 1)[0] ?? "";
  return decoded(path)?.startsWith("/") ?? false;
}

function uniqueAliasPath(target: string, paths: readonly string[]): string | undefined {
  const path = targetPath(target);
  if (!path) return undefined;
  const matches = paths.filter((candidate) => {
    const normalized = safePath(candidate);
    return (
      normalized === path ||
      normalized?.replace(/\.[^.]+$/u, "") === path ||
      filename(normalized ?? "") === filename(path) ||
      stem(normalized ?? "") === stem(path)
    );
  });
  return matches.length === 1 ? matches[0] : undefined;
}

function missingRootPath(target: string): string | undefined {
  const path = targetPath(target);
  return path ? (/\.[^/]+$/u.test(path) ? path : `${path}.md`) : undefined;
}

export function resolvedWikiLinkContent(
  source: string,
  value: string,
  paths: readonly string[],
): string | undefined {
  const { target, label } = rawLink(value);
  if (!target) return undefined;
  const resolved = resolveLink(source, target, paths, "wiki");
  if (resolved.kind === "note")
    return canonicalWikiLinkContent(resolved.path, { anchor: resolved.anchor, label });
  if (resolved.kind !== "missing" || rootTarget(target)) return undefined;
  const path = uniqueAliasPath(target, paths);
  return path ? canonicalWikiLinkContent(path, { label }) : undefined;
}

function typedWikiLinkContent(
  source: string,
  value: string,
  paths: readonly string[],
): string | undefined {
  const known = resolvedWikiLinkContent(source, value, paths);
  if (known) return known;
  const { target, label } = rawLink(value);
  const resolved = resolveLink(source, target, paths, "wiki");
  if (resolved.kind !== "missing") return undefined;
  const path = missingRootPath(target);
  return path ? canonicalWikiLinkContent(path, { anchor: resolved.anchor, label }) : undefined;
}

type SyntaxRange = { readonly from: number; readonly to: number };
const excludedSyntax = new Set([
  "CodeBlock",
  "FencedCode",
  "InlineCode",
  "HTMLBlock",
  "HTMLTag",
  "Escape",
]);
const containerSyntax = new Set(["Link", "Image"]);

function syntaxRanges(content: string): {
  readonly excluded: readonly SyntaxRange[];
  readonly containers: readonly SyntaxRange[];
} {
  const excluded: SyntaxRange[] = [];
  const containers: SyntaxRange[] = [];
  const cursor = parser.parse(content).cursor();
  do {
    const range = { from: cursor.from, to: cursor.to };
    if (excludedSyntax.has(cursor.name)) excluded.push(range);
    if (containerSyntax.has(cursor.name)) containers.push(range);
  } while (cursor.next());
  return { excluded, containers };
}

function overlaps(left: SyntaxRange, right: SyntaxRange): boolean {
  return left.from < right.to && left.to > right.from;
}

function contains(container: SyntaxRange, range: SyntaxRange): boolean {
  return container.from <= range.from && container.to >= range.to;
}

function changed(match: WikiEditRange, ranges: readonly WikiEditRange[]): boolean {
  return ranges.some((range) => range.from < match.to && range.to > match.from);
}

// The regex pass is cheap; the full Markdown parse runs only when an edit touched a wiki link.
function wikiMatches(content: string, edited: readonly WikiEditRange[]): readonly WikiMatch[] {
  const matches: WikiMatch[] = [];
  for (const match of content.matchAll(/!?\[\[([^\]\n]+)\]\]/gu)) {
    const from = (match.index ?? 0) + (match[0]?.startsWith("!") ? 1 : 0);
    const to = from + (match[0]?.length ?? 0) - (match[0]?.startsWith("!") ? 1 : 0);
    const value = match[1] ?? "";
    if (value && changed({ from, to }, edited)) matches.push({ from, to, value });
  }
  if (!matches.length) return matches;
  const syntax = syntaxRanges(content);
  return matches.filter(
    (range) =>
      !syntax.excluded.some((item) => overlaps(item, range)) &&
      !syntax.containers.some((item) => contains(item, range)),
  );
}

export function canonicalWikiEdits(options: WikiEditOptions): readonly WikiEdit[] {
  return wikiMatches(options.content, options.changed).flatMap((match) => {
    const content = typedWikiLinkContent(options.source, match.value, options.paths);
    return content && content !== match.value
      ? [{ from: match.from, to: match.to, insert: `[[${content}]]` }]
      : [];
  });
}
