/**
 * The editor side: expanding trigger tags, and Tab / Shift+Tab between a schema line's fields.
 */
import {
	Annotation,
	EditorSelection,
	EditorState,
	Extension,
	Prec,
	Transaction,
	TransactionSpec,
} from "@codemirror/state";
import { EditorView, keymap, ViewUpdate } from "@codemirror/view";
import { endsWithTag, fieldAt, findTag, InlineField, normalizeTag, parseFields } from "./fields";
import type { SchemaRule } from "./schema";
import { firstFieldSelection, renderTemplate, TemplateContext, templateFields } from "./template";

export const schemaExpansionAnnotation = Annotation.define<boolean>();

/** Completions and pastes longer than this are never treated as typing a tag. */
const MAX_COMPLETION_LENGTH = 100;

export interface ExpanderOptions {
	getSchemas: () => SchemaRule[];
	/** Date, time and note title for `{{date}}`, `{{time}}` and `{{title}}`. */
	getContext: (state: EditorState) => TemplateContext;
	tabNavigation: () => boolean;
}

function schemaKeys(rule: SchemaRule): Set<string> {
	return new Set(templateFields(rule.expansionText).map((f) => f.keyLower));
}

/** Already expanded: the rest of the line holds one of the schema's fields. */
function alreadyExpanded(rest: string, rule: SchemaRule): boolean {
	const keys = schemaKeys(rule);
	return parseFields(rest).some((f) => keys.has(f.keyLower));
}

/** Replaces `from..to` (the tag and what follows it) with the rendered template. */
function expansionSpec(from: number, to: number, rule: SchemaRule, ctx: TemplateContext): TransactionSpec {
	const text = renderTemplate(rule.expansionText, ctx);
	const tagAt = Math.max(0, findTag(text, rule.triggerTag));
	const sel = firstFieldSelection(text, tagAt);
	return {
		changes: { from, to, insert: text },
		selection: EditorSelection.single(from + sel.anchor, from + sel.head),
		annotations: [schemaExpansionAnnotation.of(true), Transaction.userEvent.of("input.complete")],
		scrollIntoView: true,
	};
}

/**
 * After a document change, the expansion it calls for (if any). A typed space or tab after a tag
 * expands it, as does a completion or paste that ends with a tag (Obsidian's tag suggestions, Inline
 * Autocomplete), optionally followed by one space.
 */
export function buildExpansionTransaction(
	update: ViewUpdate,
	getSchemas: () => SchemaRule[],
	getContext: (state: EditorState) => TemplateContext = () => ({ date: "", time: "", title: "" })
): TransactionSpec | null {
	if (!update.docChanged) return null;
	for (const tr of update.transactions) {
		if (tr.annotation(schemaExpansionAnnotation)) return null;
		if (tr.isUserEvent("undo") || tr.isUserEvent("redo")) return null;
	}
	const schemas = getSchemas();
	if (!schemas || schemas.length === 0) return null;

	let spec: TransactionSpec | null = null;
	update.changes.iterChanges((_fromA, _toA, fromB, toB, inserted) => {
		if (spec) return;
		const text = inserted.toString();
		if (!text || text.length > MAX_COMPLETION_LENGTH || text.includes("\n")) return;
		const line = update.state.doc.lineAt(toB);
		const before = line.text.slice(0, toB - line.from);
		const rest = line.text.slice(toB - line.from);
		const typedTrigger = text === " " || text === "\t";
		if (!typedTrigger && text.length < 2) return;

		// The text that must end with the tag: without the typed space, or one trailing space.
		const head = typedTrigger ? before.slice(0, -1) : before.replace(/[ \t]$/, "");
		for (const rule of schemas) {
			const tag = normalizeTag(rule.triggerTag);
			if (!tag || !rule.expansionText || !endsWithTag(head, tag)) continue;
			const tagStart = line.from + head.length - tag.length;
			// A completion counts only if it wrote (part of) the tag, not text somewhere after it.
			if (!typedTrigger && tagStart + tag.length <= fromB) continue;
			if (alreadyExpanded(rest, rule)) continue;
			spec = expansionSpec(tagStart, toB, rule, getContext(update.state));
			break;
		}
	});
	return spec;
}

/** Tab right after a tag: expand it (Obsidian would otherwise indent a list line). */
export function expandBeforeCursor(state: EditorState, schemas: SchemaRule[], ctx: TemplateContext): TransactionSpec | null {
	const sel = state.selection.main;
	if (!sel.empty) return null;
	const line = state.doc.lineAt(sel.head);
	const before = line.text.slice(0, sel.head - line.from);
	const rest = line.text.slice(sel.head - line.from);
	for (const rule of schemas) {
		const tag = normalizeTag(rule.triggerTag);
		if (!tag || !rule.expansionText || !endsWithTag(before, tag) || alreadyExpanded(rest, rule)) continue;
		return expansionSpec(sel.head - tag.length, sel.head, rule, ctx);
	}
	return null;
}

/** The schema whose tag appears first on a line, and where. */
export function schemaOnLine(text: string, schemas: SchemaRule[]): { rule: SchemaRule; tagIndex: number } | null {
	let best: { rule: SchemaRule; tagIndex: number } | null = null;
	for (const rule of schemas) {
		const i = findTag(text, rule.triggerTag);
		if (i !== -1 && (!best || i < best.tagIndex)) best = { rule, tagIndex: i };
	}
	return best;
}

function target(f: InlineField): { from: number; to: number } {
	return { from: f.valueFrom, to: f.valueTo };
}

/**
 * Tab: the next empty field on a schema line (wrapping to the first), skipping the one the cursor
 * is in. Null when no empty field is left, so Tab does what it normally does.
 */
export function nextFieldTarget(lineText: string, cursor: number, schemas: SchemaRule[]): { from: number; to: number } | null {
	const found = schemaOnLine(lineText, schemas);
	if (!found) return null;
	const fields = parseFields(lineText, found.tagIndex);
	const current = fieldAt(fields, cursor);
	const empty = fields.filter((f) => !f.value && f !== current);
	const next = empty.find((f) => f.from >= cursor) ?? empty[0];
	return next ? target(next) : null;
}

/** Shift+Tab: the field before the one the cursor is in (or the last one before the cursor). */
export function previousFieldTarget(lineText: string, cursor: number, schemas: SchemaRule[]): { from: number; to: number } | null {
	const found = schemaOnLine(lineText, schemas);
	if (!found) return null;
	const fields = parseFields(lineText, found.tagIndex);
	const current = fieldAt(fields, cursor);
	if (current) {
		const i = fields.indexOf(current);
		return i > 0 ? target(fields[i - 1]) : null;
	}
	const before = fields.filter((f) => f.to <= cursor);
	return before.length > 0 ? target(before[before.length - 1]) : null;
}

function moveTo(view: EditorView, lineFrom: number, t: { from: number; to: number }): boolean {
	view.dispatch({
		selection: EditorSelection.single(lineFrom + t.from, lineFrom + t.to),
		scrollIntoView: true,
		// No "select" user event: Obsidian nudges such selections past a closing bracket.
	});
	return true;
}

/**
 * CodeMirror extension: expands tags as they are typed or completed, and binds Tab / Shift+Tab.
 * The keymap sits below Inline Autocomplete's (Prec.highest), so Tab still accepts its ghost text.
 */
export function createSchemaExpanderExtension(opts: ExpanderOptions): Extension {
	const listener = EditorView.updateListener.of((update: ViewUpdate) => {
		const spec = buildExpansionTransaction(update, opts.getSchemas, opts.getContext);
		if (spec) update.view.dispatch(spec);
	});

	const keys = Prec.high(
		keymap.of([
			{
				key: "Tab",
				run: (view) => {
					const schemas = opts.getSchemas();
					const spec = expandBeforeCursor(view.state, schemas, opts.getContext(view.state));
					if (spec) {
						view.dispatch(spec);
						return true;
					}
					if (!opts.tabNavigation()) return false;
					const sel = view.state.selection.main;
					const line = view.state.doc.lineAt(sel.head);
					const t = nextFieldTarget(line.text, sel.head - line.from, schemas);
					return t ? moveTo(view, line.from, t) : false;
				},
			},
			{
				key: "Shift-Tab",
				run: (view) => {
					if (!opts.tabNavigation()) return false;
					const sel = view.state.selection.main;
					const line = view.state.doc.lineAt(sel.head);
					const t = previousFieldTarget(line.text, sel.head - line.from, opts.getSchemas());
					return t ? moveTo(view, line.from, t) : false;
				},
			},
		])
	);
	return [listener, keys];
}
