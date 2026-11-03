import { VaultError } from "../storage/errors";
import type { Note, Vault } from "./types";

export async function readWorkspaceNotes(
  vault: Vault,
): Promise<{ readonly notes: Map<string, Note>; readonly skipped: number }> {
  const notes = new Map<string, Note>();
  let skipped = 0;
  for (const entry of vault.entries) {
    if (entry.kind !== "note") continue;
    try {
      const snapshot = await vault.read(entry.path);
      notes.set(entry.path, { path: entry.path, content: snapshot.content });
    } catch (error) {
      // One oversized or unreadable note must not keep the whole vault closed.
      if (!(error instanceof VaultError)) throw error;
      skipped += 1;
    }
  }
  return { notes, skipped };
}

export function skippedNotice(skipped: number, hidden = 0): string {
  const parts = [
    skipped ? `읽을 수 없는 노트 ${skipped}개` : "",
    hidden ? `이름 규칙(? : * 등)에 맞지 않는 파일 ${hidden}개` : "",
  ].filter(Boolean);
  return parts.length ? ` ${parts.join("와 ")}는 건너뛰었습니다.` : "";
}

export function initialWorkspaceNote(notes: ReadonlyMap<string, Note>): Note | undefined {
  return (
    [...notes.values()].find((note) => /환영|welcome|시작/iu.test(note.path)) ??
    notes.values().next().value
  );
}
