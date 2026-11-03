// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/ui/workspace-view", () => ({ renderWorkspace: () => undefined }));

import { Workspace } from "../src/core/workspace";
import { useMemoryStoreForTesting } from "../src/storage/browser-store";
import { bindAppActions } from "../src/ui/app-actions";
import { createShell } from "../src/ui/shell";

let restoreStore: (() => void) | undefined;

beforeEach(() => {
  restoreStore = useMemoryStoreForTesting();
});

afterEach(() => {
  restoreStore?.();
  restoreStore = undefined;
  vi.restoreAllMocks();
});

describe("folder picker", () => {
  it("says the folder opens read-only before falling back in browsers without folder access", async () => {
    expect("showDirectoryPicker" in window).toBe(false);
    const workspace = new Workspace(createShell(document.body));
    bindAppActions(workspace);
    const picker = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => undefined);
    const open = [...document.querySelectorAll<HTMLButtonElement>(".welcome-actions button")].find(
      (item) => item.textContent === "폴더 열기",
    );
    open?.click();
    await vi.waitFor(() => expect(picker).toHaveBeenCalled());
    expect(document.querySelector(".notice")?.textContent).toBe(
      "이 브라우저는 원본 폴더 저장을 지원하지 않아 읽기 전용으로 엽니다.",
    );
  });
});
