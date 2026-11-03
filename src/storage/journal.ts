import { deleteStored, listStored, readStored, writeStored } from "./browser-store";

export type Draft = {
  readonly vaultId: string;
  readonly path: string;
  readonly content: string;
  readonly baseFingerprint: string;
  readonly revision: number;
  readonly savedAt: number;
  readonly sessionId?: string;
};

export const draftSessionId = crypto.randomUUID();

function key(vaultId: string, path: string, sessionId: string): string {
  return `${vaultId}:${path}:${sessionId}`;
}

export async function writeDraft(draft: Draft): Promise<void> {
  await writeStored("drafts", key(draft.vaultId, draft.path, draft.sessionId ?? draftSessionId), {
    ...draft,
    sessionId: draft.sessionId ?? draftSessionId,
  });
}

export async function readDraft(vaultId: string, path: string): Promise<Draft | undefined> {
  return (await listDrafts(vaultId))
    .filter((draft) => draft.path === path)
    .sort((left, right) => right.savedAt - left.savedAt)[0];
}

export async function listDrafts(vaultId: string): Promise<readonly Draft[]> {
  return (await listStored("drafts", `${vaultId}:`)).flatMap((item) => {
    const draft = parseDraft(item);
    return draft ? [draft] : [];
  });
}

export async function discardDraft(vaultId: string, path: string): Promise<void> {
  await deleteStored("drafts", key(vaultId, path, draftSessionId));
}

export async function discardSpecificDraft(draft: Draft): Promise<void> {
  const sessionId = draft.sessionId ?? draftSessionId;
  const current = parseDraft(await readStored("drafts", key(draft.vaultId, draft.path, sessionId)));
  if (current?.revision === draft.revision)
    await deleteStored("drafts", key(draft.vaultId, draft.path, sessionId));
}

function parseDraft(value: unknown): Draft | undefined {
  if (!isRecord(value)) return undefined;
  const { vaultId, path, content, baseFingerprint, revision, savedAt, sessionId } = value;
  if (
    typeof vaultId !== "string" ||
    typeof path !== "string" ||
    typeof content !== "string" ||
    typeof baseFingerprint !== "string" ||
    typeof revision !== "number" ||
    typeof savedAt !== "number"
  )
    return undefined;
  if (sessionId !== undefined && typeof sessionId !== "string") return undefined;
  return {
    vaultId,
    path,
    content,
    baseFingerprint,
    revision,
    savedAt,
    sessionId: sessionId ?? "legacy",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
