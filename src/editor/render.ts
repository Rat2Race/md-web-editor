import DOMPurify from "dompurify";
import type { NoteLink } from "../core/types";
import {
  decoded,
  directory,
  indexDocument,
  type MarkdownContext,
  markdownHtml,
  safePath,
} from "./markdown";
import { footnoteNodes, wikiNodes } from "./render-nodes";

type RenderOptions = {
  readonly source: string;
  readonly root: HTMLElement;
  readonly asset: (target: string) => Promise<Blob | undefined>;
  readonly onLink: (target: string, kind?: NoteLink["kind"]) => void;
  readonly context?: MarkdownContext;
  readonly onFootnote?: (id: string) => void;
};

const resources = new Set([
  "src",
  "srcset",
  "poster",
  "background",
  "action",
  "formaction",
  "ping",
  "cite",
  "xlink:href",
]);
const forbidden = [
  "base",
  "button",
  "embed",
  "form",
  "frame",
  "iframe",
  "input",
  "math",
  "object",
  "script",
  "source",
  "style",
  "svg",
  "track",
  "video",
  "audio",
];

function sanitize(): void {
  DOMPurify.removeAllHooks();
  DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
    const name = data.attrName.toLocaleLowerCase();
    if (name === "href") {
      if (!/^(?:\/\/|javascript:|data:|file:)/iu.test(data.attrValue)) {
        node.setAttribute("data-md-href", data.attrValue);
      }
      data.keepAttr = false;
      return;
    }
    if (name.startsWith("on") || name === "style" || resources.has(name)) {
      if (name === "src") node.setAttribute("data-md-src", data.attrValue);
      data.keepAttr = false;
    }
  });
}

function taskMarkup(html: string): string {
  return html.replace(
    /<li>\s*(<p>)?\[([ xX])\]\s+/gu,
    (_all, paragraph: string | undefined, checked: string) =>
      `<li class="task-list-item">${paragraph ?? ""}<span class="task-checkbox" role="checkbox" aria-checked="${checked !== " "}"></span>`,
  );
}

function followAnchor(options: RenderOptions, target: string, kind: NoteLink["kind"]): void {
  if (target.startsWith("#")) {
    const destination = [...options.root.querySelectorAll<HTMLElement>("[id]")].find(
      (element) => element.id === target.slice(1),
    );
    if (destination) {
      destination.scrollIntoView({ block: "center" });
      return;
    }
  }
  options.onLink(target, kind);
}

export function renderMarkdown(content: string, options: RenderOptions): () => void {
  sanitize();
  options.root.replaceChildren();
  options.root.className = "markdown-reading";
  options.root.innerHTML = DOMPurify.sanitize(
    taskMarkup(markdownHtml(content, options.context?.environment)),
    {
      ADD_ATTR: ["data-md-href", "data-md-src", "class", "role", "aria-checked"],
      FORBID_TAGS: forbidden,
      FORBID_ATTR: ["style", "ping", "target"],
    },
  );
  wikiNodes(options.root);
  if (options.context) footnoteNodes(options.root, options.context.footnotes);
  for (const link of options.root.querySelectorAll<HTMLElement>("[data-md-href]")) {
    link.tabIndex = 0;
    link.setAttribute("role", "link");
  }
  for (const footnote of options.root.querySelectorAll<HTMLElement>("[data-md-footnote]")) {
    footnote.tabIndex = 0;
    footnote.setAttribute("role", "link");
  }
  const headings = indexDocument(content).headings;
  options.root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6").forEach((heading, index) => {
    const metadata = headings[index];
    if (!metadata) return;
    heading.id = metadata.id;
    heading.setAttribute("data-source-line", String(metadata.line));
  });
  const urls = new Set<string>();
  let disposed = false;
  const onClick = (event: MouseEvent): void => {
    const footnote =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-md-footnote]")
        : null;
    const id = footnote?.getAttribute("data-md-footnote");
    if (id && options.onFootnote) {
      event.preventDefault();
      options.onFootnote(id);
      return;
    }
    const link =
      event.target instanceof Element ? event.target.closest<HTMLElement>("[data-md-href]") : null;
    const target = link?.getAttribute("data-md-href");
    if (target) {
      event.preventDefault();
      followAnchor(
        options,
        target,
        link?.getAttribute("data-md-kind") === "wiki" ? "wiki" : "markdown",
      );
    }
  };
  options.root.addEventListener("click", onClick);
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const footnote =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-md-footnote]")
        : null;
    const id = footnote?.getAttribute("data-md-footnote");
    if (id && options.onFootnote) {
      event.preventDefault();
      options.onFootnote(id);
      return;
    }
    const link =
      event.target instanceof Element ? event.target.closest<HTMLElement>("[data-md-href]") : null;
    const target = link?.getAttribute("data-md-href");
    if (!target) return;
    event.preventDefault();
    followAnchor(
      options,
      target,
      link?.getAttribute("data-md-kind") === "wiki" ? "wiki" : "markdown",
    );
  };
  options.root.addEventListener("keydown", onKeydown);
  for (const image of options.root.querySelectorAll<HTMLImageElement>("img[data-md-src]")) {
    const target = image.getAttribute("data-md-src");
    const path =
      target && !/^(?:\/\/|[a-z][a-z\d+.-]*:)/iu.test(target)
        ? safePath(`${directory(options.source)}${decoded(target) ?? ".."}`)
        : undefined;
    if (!path) {
      image.replaceWith(document.createTextNode(image.alt));
      continue;
    }
    void options
      .asset(target ?? path)
      // Vault.asset() already checked the image signature and size (validImage, assertSize).
      .then((blob) => {
        if (blob && image.isConnected && !disposed) {
          const url = URL.createObjectURL(blob);
          urls.add(url);
          image.src = url;
        }
      })
      .catch(() => image.replaceWith(document.createTextNode(image.alt)));
  }
  return () => {
    disposed = true;
    options.root.removeEventListener("click", onClick);
    options.root.removeEventListener("keydown", onKeydown);
    for (const url of urls) URL.revokeObjectURL(url);
  };
}
