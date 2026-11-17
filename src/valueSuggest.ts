/** Suggests a field's choices and the values used for it before, while the cursor is in the field. */
import { Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, TFile } from "obsidian";
import { fieldAt, parseFields } from "./fields";
import type InlineSchemaExpanderPlugin from "./main";
import { schemaOnLine } from "./schemaExpander";
import { templateFields } from "./template";

interface ValueSuggestion {
	value: string;
	/** "choice" or how often it is used. */
	aux: string;
}

/** Fields whose earlier values average longer than this (a ratio, a summary) get no suggestions. */
const MAX_AVERAGE_LENGTH = 28;

export class FieldValueSuggest extends EditorSuggest<ValueSuggestion> {
	private tag = "";
	private key = "";
	private choices: string[] = [];

	constructor(private readonly plugin: InlineSchemaExpanderPlugin) {
		super(plugin.app);
		this.limit = 12;
	}

	onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
		if (!this.plugin.settings.suggestValues) return null;
		const lineText = editor.getLine(cursor.line);
		const found = schemaOnLine(lineText, this.plugin.settings.schemas);
		if (!found) return null;
		const field = fieldAt(parseFields(lineText, found.tagIndex), cursor.ch);
		if (!field || cursor.ch < field.valueFrom) return null;
		const tf = templateFields(found.rule.expansionText).find((f) => f.keyLower === field.keyLower);
		this.choices = tf?.choices ?? [];
		this.tag = found.rule.triggerTag;
		this.key = field.key;
		if (this.choices.length === 0) {
			const used = this.plugin.index.values(this.tag, this.key);
			if (used.length === 0) return null;
			const avg = used.reduce((n, u) => n + u.value.length, 0) / used.length;
			if (avg > MAX_AVERAGE_LENGTH) return null;
		}
		return {
			start: { line: cursor.line, ch: field.valueFrom },
			end: { line: cursor.line, ch: field.to - 1 },
			query: lineText.slice(field.valueFrom, cursor.ch).trim(),
		};
	}

	getSuggestions(context: EditorSuggestContext): ValueSuggestion[] {
		const q = context.query.toLowerCase();
		const current = context.editor.getRange(context.start, context.end).trim().toLowerCase();
		const out: ValueSuggestion[] = [];
		const seen = new Set<string>();
		const add = (value: string, aux: string) => {
			const id = value.toLowerCase();
			if (seen.has(id) || (q && !id.includes(q))) return;
			seen.add(id);
			out.push({ value, aux });
		};
		for (const c of this.choices) add(c, "choice");
		for (const u of this.plugin.index.values(this.tag, this.key)) add(u.value, u.count === 1 ? "used once" : `used ${u.count}×`);
		// Nothing to offer when the field already holds the only match.
		if (out.length === 1 && out[0].value.toLowerCase() === current) return [];
		return out;
	}

	renderSuggestion(s: ValueSuggestion, el: HTMLElement): void {
		el.addClass("mod-complex", "ise-value-suggestion");
		el.createDiv({ cls: "suggestion-content" }).createDiv({ cls: "suggestion-title", text: s.value });
		el.createDiv({ cls: "suggestion-aux" }).createSpan({ cls: "suggestion-flair ise-value-aux", text: s.aux });
	}

	selectSuggestion(s: ValueSuggestion): void {
		const ctx = this.context;
		if (!ctx) return;
		ctx.editor.replaceRange(s.value, ctx.start, ctx.end);
		ctx.editor.setCursor({ line: ctx.start.line, ch: ctx.start.ch + s.value.length });
		this.close();
	}
}
