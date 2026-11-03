/** Local paths never become browser URLs. */
export type Note = { readonly path: string; readonly content: string };
export type FileSnapshot = { readonly content: string; readonly fingerprint: string };
export type VaultEntry = {
  readonly path: string;
  readonly kind: "note" | "asset";
  readonly modified: number;
};
export interface VaultBase {
  readonly id: string;
  readonly name: string;
  readonly entries: readonly VaultEntry[];
  /** Files left out because their names break the vault path rules. */
  readonly hidden?: number;
  read(path: string): Promise<FileSnapshot>;
  asset(path: string): Promise<Blob | undefined>;
  file?(path: string): Promise<File | undefined>;
  refresh(): Promise<void>;
  close(): void;
}
export interface WritableVault extends VaultBase {
  readonly kind: "folder" | "demo";
  write(path: string, content: string, expected: string): Promise<FileSnapshot>;
  create(path: string, content: string): Promise<FileSnapshot>;
}
export interface ReadonlyVault extends VaultBase {
  readonly kind: "readonly";
}
export type Vault = WritableVault | ReadonlyVault;
export type NoteLink = {
  readonly target: string;
  readonly label: string;
  readonly kind: "wiki" | "markdown" | "embed";
};
export type DocumentIndex = {
  readonly links: readonly NoteLink[];
  readonly tags: readonly string[];
  readonly headings: readonly {
    readonly level: number;
    readonly text: string;
    readonly line: number;
    readonly id: string;
  }[];
};
export type ResolvedLink =
  | { readonly kind: "note"; readonly path: string; readonly anchor: string }
  | { readonly kind: "missing"; readonly path: string; readonly anchor: string }
  | { readonly kind: "external"; readonly url: string }
  | { readonly kind: "blocked" }
  | { readonly kind: "ambiguous"; readonly paths: readonly string[] };
export type GraphNode = {
  readonly id: string;
  readonly label: string;
  readonly kind: "note" | "missing" | "tag" | "asset";
  readonly tags: readonly string[];
  readonly modified: number;
  readonly candidates?: readonly string[];
};
export type GraphEdge = { readonly source: string; readonly target: string };
export type GraphData = {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
};
export type EditorMode = "live" | "source" | "reading";
export type EditorOptions = {
  readonly parent: HTMLElement;
  readonly content: string;
  readonly readonly: boolean;
  readonly mode: EditorMode;
  readonly path: string;
  readonly onChange: (content: string) => void;
  readonly onLink: (target: string, kind?: NoteLink["kind"]) => void;
  readonly asset: (target: string) => Promise<Blob | undefined>;
  readonly completions: () => readonly string[];
};
export interface NoteEditor {
  setDocument(content: string, path: string): void;
  syncContent(content: string): void;
  setMode(mode: EditorMode): void;
  setReadonly(value: boolean): void;
  getContent(): string;
  focus(): void;
  goToLine(line: number): void;
  format(action: "bold" | "italic" | "link" | "code" | "heading" | "task" | "quote"): void;
  undo(): void;
  redo(): void;
  find(): void;
  destroy(): void;
}
