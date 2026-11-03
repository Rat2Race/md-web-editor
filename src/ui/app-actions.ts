import type { Workspace } from "../core/workspace";
import { createDemoVault, importFolder, openFolder } from "../storage/vault";
import { type Command, installCommands, showChoices } from "./commands";
import { button, download, element, iconButton } from "./dom";
import { getPreferences, showSettings, toggleTheme } from "./theme";
export function bindAppActions(app: Workspace) {
  const { shell } = app;
  const pick = () =>
    app.run(async () => {
      if (!(await app.canLeave())) return;
      if ("showDirectoryPicker" in window) await app.setVault(await openFolder());
      else {
        app.notice("이 브라우저는 원본 폴더 저장을 지원하지 않아 읽기 전용으로 엽니다.");
        fallback.click();
      }
    });
  const demo = () =>
    app.run(async () => {
      if (await app.canLeave()) await app.setVault(await createDemoVault());
    });
  const fallback = element("input");
  fallback.type = "file";
  fallback.multiple = true;
  fallback.setAttribute("webkitdirectory", "");
  fallback.hidden = true;
  fallback.addEventListener("change", () => {
    const files = fallback.files;
    if (files)
      app.run(async () => {
        await app.setVault(await importFolder(files));
        fallback.value = "";
      });
  });
  document.body.append(fallback);
  const search = () => {
    shell.shell.classList.remove("hide-explorer");
    shell.search.focus();
  };
  const quick = () =>
    showChoices(
      "노트 빠른 전환",
      (app.vault?.entries ?? [])
        .filter((entry) => entry.kind === "note" || getPreferences().linkAllFiles)
        .map((note) => ({
          label: note.path,
          run: () => app.run(() => app.open(note.path)),
        })),
    );
  const format = (kind: "bold" | "italic" | "link" | "code" | "heading" | "task" | "quote") =>
    app.editor()?.format(kind);
  const commands: Command[] = [
    { key: "p", label: "명령 팔레트", run: () => controller.palette() },
    { key: "o", label: "빠른 전환", run: quick },
    { key: "f", label: "노트 검색", run: search },
    { key: "n", label: "새 노트", run: () => app.createNote() },
    { key: "d", label: "오늘의 노트", run: () => app.run(() => app.daily()) },
    { key: "g", label: "전체 그래프", run: () => app.showGraph() },
    { key: "l", label: "로컬 그래프", run: () => app.showGraph(true) },
    { key: "e", label: "편집 모드 전환", run: () => app.mode() },
    { key: "b", label: "굵게", run: () => format("bold") },
    { key: "i", label: "기울임", run: () => format("italic") },
    { key: "k", label: "위키 링크", run: () => format("link") },
    { key: "c", label: "코드", run: () => format("code") },
    { key: "h", label: "제목", run: () => format("heading") },
    { key: "x", label: "할 일", run: () => format("task") },
    { key: "q", label: "인용", run: () => format("quote") },
    { key: "z", label: "실행 취소", run: () => app.editor()?.undo() },
    { key: "y", label: "다시 실행", run: () => app.editor()?.redo() },
    { key: "/", label: "노트 안에서 찾기", run: () => app.editor()?.find() },
    { key: "s", label: "지금 저장", run: () => app.run(() => app.canLeave()) },
    { key: "t", label: "테마 전환", run: toggleTheme },
    { key: ",", label: "설정", run: showSettings },
    { key: "[", label: "이전 탭", run: () => app.nextTab(-1) },
    { key: "]", label: "다음 탭", run: () => app.nextTab(1) },
    { key: "w", label: "탭 닫기", run: () => app.run(() => app.closeTab()) },
    { key: "r", label: "오른쪽에 그래프 열기", run: () => app.panes.graphRight() },
    {
      key: "v",
      label: "오른쪽 분할",
      run: () => {
        const tab = app.panes.layout.activeTab();
        if (tab) app.run(() => app.panes.duplicate(tab.id, "right"));
      },
    },
    {
      key: "j",
      label: "아래쪽 분할",
      run: () => {
        const tab = app.panes.layout.activeTab();
        if (tab) app.run(() => app.panes.duplicate(tab.id, "bottom"));
      },
    },
    { key: "3", label: "다음 패널", run: () => app.panes.nextGroup() },
    { key: "1", label: "파일 패널", run: () => shell.shell.classList.toggle("hide-explorer") },
    {
      key: "2",
      label: "정보 패널",
      run: () =>
        shell.shell.classList.toggle(innerWidth <= 1100 ? "show-inspector" : "hide-inspector"),
    },
  ];
  const controller = installCommands(commands);
  shell.prefix.addEventListener("click", () => controller.palette());
  shell.railTop.append(
    iconButton("노트 빠른 전환 · Esc O", "▤", quick),
    iconButton("노트 검색 · Esc F", "⌕", search),
    iconButton("그래프 뷰 · Esc G", "♧", () => app.showGraph()),
    iconButton("오늘의 노트 · Esc D", "▦", () => app.run(() => app.daily())),
    iconButton("명령 팔레트 · Esc P", "⌘", () => controller.palette()),
  );
  shell.railBottom.append(
    iconButton("테마 전환 · Esc T", "◐", toggleTheme),
    iconButton("설정 · Esc ,", "⚙", showSettings),
  );
  shell.vaultActions.append(
    iconButton("새 노트 · Esc N", "+", () => app.createNote()),
    iconButton("폴더 새로고침", "↻", () => app.run(() => app.refresh())),
  );
  const local = element("div", "local-label");
  local.append(element("span", "local-dot"), document.createTextNode("이 기기에만 저장됩니다"));
  shell.vaultFooter.append(
    button("폴더 열기", pick),
    button("읽기 전용으로 폴더 열기", () => fallback.click(), "button subtle"),
    local,
  );
  shell.welcome.append(
    element("span", "brand", ".md"),
    element("h1", "", "당신의 노트,\n당신의 기기에."),
    element(
      "p",
      "",
      "파일을 열고, 생각을 적고, 링크로 연결하세요. 계정도 클라우드도 필요 없는 나만의 Markdown 작업 공간입니다.",
    ),
  );
  const actions = element("div", "welcome-actions");
  actions.append(button("폴더 열기", pick, "button primary"), button("예제 둘러보기", demo));
  shell.welcome.append(actions);
  const help = element("div", "welcome-help");
  const line = element("span");
  line.append(
    element("kbd", "", "Esc"),
    document.createTextNode("다음"),
    element("kbd", "", "P"),
    document.createTextNode("명령 팔레트 열기"),
  );
  help.append(
    line,
    element("span", "", "[[위키 링크]]와 Markdown 링크로 노트를 연결합니다."),
    element("span", "", "노트 내용은 서버로 전송되지 않습니다."),
  );
  shell.welcome.append(
    help,
    element("span", "version", `md-web-editor ${__APP_VERSION__} · ${__BUILD_SHA__}`),
  );
  const exportButton = iconButton("현재 노트 내려받기", "↓", () => {
    const tab = app.panes.layout.activeTab();
    const editor = app.editor();
    if (tab?.kind === "note" && editor)
      download(tab.path.split("/").at(-1) ?? "note.md", editor.getContent());
    else app.notice("먼저 노트를 여세요.");
  });
  shell.railBottom.prepend(exportButton);
  if (innerWidth <= 760) shell.shell.classList.add("hide-explorer");
}
