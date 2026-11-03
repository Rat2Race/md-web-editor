import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { type EditorState, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import type { NoteLink } from "../core/types";
import { type MarkdownContext, markdownContext, renderMarkdown, taskOffsets } from "./markdown";

type LiveOptions = {
  readonly path: () => string;
  readonly asset: (target: string) => Promise<Blob | undefined>;
  readonly onLink: (target: string, kind?: NoteLink["kind"]) => void;
  readonly writable: () => boolean;
};
type Block = { readonly from: number; readonly to: number };
type LiveState = { readonly decorations: DecorationSet; readonly active: string };

function blocks(state: EditorState): readonly Block[] {
  const cursor = (ensureSyntaxTree(state, state.doc.length, 20) ?? syntaxTree(state)).cursor();
  const output: Block[] = [];
  if (!cursor.firstChild()) return output;
  do {
    if (cursor.to > cursor.from) output.push({ from: cursor.from, to: cursor.to });
  } while (cursor.nextSibling());
  return output;
}

function selected(state: EditorState, block: Block): boolean {
  const range = state.selection.main;
  return range.from <= block.to && range.to >= block.from;
}

// A widget whose eq() holds keeps its old DOM and listeners, so handlers read positions
// and context from the live view at event time instead of from the widget that drew them.
class PreviewWidget extends WidgetType {
  constructor(
    private readonly content: string,
    private readonly context: MarkdownContext,
    private readonly latest: (state: EditorState) => MarkdownContext,
    private readonly options: LiveOptions,
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof PreviewWidget &&
      other.content === this.content &&
      other.context.key === this.context.key
    );
  }

  ignoreEvent(event: Event): boolean {
    return (
      event.target instanceof Element &&
      event.target.closest("[data-md-href], [data-md-footnote], .task-checkbox") !== null
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("div");
    root.className = "cm-md-preview";
    const release = renderMarkdown(this.content, {
      source: this.options.path(),
      root,
      asset: this.options.asset,
      onLink: this.options.onLink,
      context: this.context,
      onFootnote: (id) => this.goToFootnote(view, id),
    });
    root.classList.add("cm-md-preview");
    root.addEventListener("mousedown", (event) => {
      if (
        event.target instanceof Element &&
        event.target.closest("[data-md-href], [data-md-footnote], .task-checkbox")
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      view.dispatch({ selection: { anchor: view.posAtDOM(root) } });
      view.focus();
    });
    const offsets = taskOffsets(this.content);
    root.querySelectorAll<HTMLElement>(".task-checkbox").forEach((box, index) => {
      box.tabIndex = this.options.writable() ? 0 : -1;
      box.addEventListener("click", () => this.toggle(view, root, offsets[index]));
      box.addEventListener("keydown", (event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          this.toggle(view, root, offsets[index]);
        }
      });
    });
    root.addEventListener("DOMNodeRemoved", release, { once: true });
    return root;
  }

  destroy(dom: HTMLElement): void {
    dom.dispatchEvent(new Event("DOMNodeRemoved"));
  }

  private toggle(view: EditorView, root: HTMLElement, offset: number | undefined): void {
    if (!this.options.writable() || offset === undefined) return;
    const position = view.posAtDOM(root) + offset;
    const value = view.state.sliceDoc(position, position + 1);
    view.dispatch({
      changes: {
        from: position,
        to: position + 1,
        insert: value.toLocaleLowerCase() === "x" ? " " : "x",
      },
    });
  }

  private goToFootnote(view: EditorView, id: string): void {
    const position = this.latest(view.state).footnotes.get(id);
    if (position === undefined) return;
    view.dispatch({
      selection: { anchor: position },
      effects: EditorView.scrollIntoView(position),
    });
    view.focus();
  }
}

function activeBlock(state: EditorState): string {
  return blocks(state)
    .filter((item) => selected(state, item))
    .map((item) => `${item.from}:${item.to}`)
    .join(",");
}

function decorations(
  state: EditorState,
  options: LiveOptions,
  latest: (state: EditorState) => MarkdownContext,
): DecorationSet {
  const context = latest(state);
  const ranges = blocks(state)
    .filter((block) => !selected(state, block))
    .map((block) =>
      Decoration.replace({
        block: true,
        widget: new PreviewWidget(state.sliceDoc(block.from, block.to), context, latest, options),
      }).range(block.from, block.to),
    );
  return Decoration.set(ranges, true);
}

export function livePreview(options: LiveOptions) {
  let document: EditorState["doc"] | undefined;
  let context: MarkdownContext | undefined;
  const cachedContext = (state: EditorState): MarkdownContext => {
    if (state.doc !== document || !context) {
      document = state.doc;
      context = markdownContext(state.doc.toString());
    }
    return context;
  };
  const field = StateField.define<LiveState>({
    create(state) {
      return {
        decorations: decorations(state, options, cachedContext),
        active: activeBlock(state),
      };
    },
    update(_value, transaction) {
      const active = activeBlock(transaction.state);
      if (!transaction.docChanged && active === _value.active) return _value;
      return {
        decorations: decorations(transaction.state, options, cachedContext),
        active,
      };
    },
    provide: (value) => EditorView.decorations.from(value, (state) => state.decorations),
  });
  return field;
}
