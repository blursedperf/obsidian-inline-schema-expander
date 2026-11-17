/**
 * Marks a schema line's empty fields, flags required ones, and offers a button for a required field
 * the line is missing altogether.
 */
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { parseFields } from "./fields";
import type { SchemaRule } from "./schema";
import { schemaOnLine } from "./schemaExpander";

const emptyMark = Decoration.mark({ class: "ise-field is-empty" });
const requiredMark = Decoration.mark({ class: "ise-field is-empty is-required" });

class MissingFieldWidget extends WidgetType {
	constructor(private readonly key: string, private readonly insertAt: number) {
		super();
	}

	eq(other: MissingFieldWidget): boolean {
		return other.key === this.key && other.insertAt === this.insertAt;
	}

	toDOM(view: EditorView): HTMLElement {
		const el = createEl("button", {
			cls: "ise-missing-field",
			text: `+ ${this.key}`,
			attr: { type: "button", "aria-label": `Add the required ${this.key} field` },
		});
		el.addEventListener("mousedown", (evt) => {
			evt.preventDefault();
			const insert = ` [${this.key}:: ]`;
			view.dispatch({
				changes: { from: this.insertAt, insert },
				selection: { anchor: this.insertAt + insert.length - 1 },
				userEvent: "input",
			});
			view.focus();
		});
		return el;
	}

	ignoreEvent(): boolean {
		return false;
	}
}

function build(view: EditorView, getSchemas: () => SchemaRule[]): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const schemas = getSchemas();
	if (schemas.length === 0) return builder.finish();
	for (const { from, to } of view.visibleRanges) {
		let pos = from;
		while (pos <= to) {
			const line = view.state.doc.lineAt(pos);
			const found = schemaOnLine(line.text, schemas);
			if (found) {
				const required = new Set(found.rule.requiredFields.map((k) => k.toLowerCase()));
				const fields = parseFields(line.text, found.tagIndex);
				for (const f of fields) {
					if (f.value) continue;
					builder.add(line.from + f.from, line.from + f.to, required.has(f.keyLower) ? requiredMark : emptyMark);
				}
				const have = new Set(fields.map((f) => f.keyLower));
				const missing = found.rule.requiredFields.filter((k) => !have.has(k.toLowerCase()));
				const isMarkerOnly = fields.length === 0 && !line.text.replace(/#\S+/, "").trim();
				if (missing.length > 0 && !isMarkerOnly) {
					const at = fields.length > 0 ? fields[fields.length - 1].to : line.text.length;
					for (const key of missing) {
						builder.add(line.to, line.to, Decoration.widget({ widget: new MissingFieldWidget(key, line.from + at), side: 1 }));
					}
				}
			}
			pos = line.to + 1;
		}
	}
	return builder.finish();
}

export function createFieldHighlighter(getSchemas: () => SchemaRule[], enabled: () => boolean) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			constructor(view: EditorView) {
				this.decorations = enabled() ? build(view, getSchemas) : Decoration.none;
			}
			update(update: ViewUpdate) {
				if (update.docChanged || update.viewportChanged || update.focusChanged) {
					this.decorations = enabled() ? build(update.view, getSchemas) : Decoration.none;
				}
			}
		},
		{ decorations: (v) => v.decorations }
	);
}
