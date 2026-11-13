import {
	Annotation,
	EditorSelection,
	Extension,
	Transaction,
	TransactionSpec,
} from "@codemirror/state";
import { EditorView, ViewUpdate } from "@codemirror/view";

export interface SchemaRule {
	triggerTag: string;
	expansionText: string;
	/**
	 * Number of characters back from the end of `expansionText` where the cursor
	 * should be placed. If 0 (or negative), the first empty bracket `]` is matched via regex.
	 */
	cursorOffset: number;
}

export const DEFAULT_SCHEMAS: SchemaRule[] = [
	{
		triggerTag: "#case-law",
		expansionText: "#case-law [court:: ] [year:: ] [ratio:: ]",
		cursorOffset: 22,
	},
];

/** Keep only well-formed schemas from saved data. */
export function loadSchemas(raw: unknown): SchemaRule[] | null {
	if (!raw || typeof raw !== "object" || !Array.isArray((raw as { schemas?: unknown }).schemas)) {
		return null;
	}
	return ((raw as { schemas: unknown[] }).schemas)
		.filter((s): s is SchemaRule => {
			const r = s as Partial<SchemaRule> | null;
			return (
				!!r &&
				typeof r.triggerTag === "string" &&
				typeof r.expansionText === "string" &&
				typeof r.cursorOffset === "number"
			);
		})
		.map((s) => ({ triggerTag: s.triggerTag, expansionText: s.expansionText, cursorOffset: s.cursorOffset }));
}

export const schemaExpansionAnnotation = Annotation.define<boolean>();

const FIRST_EMPTY_BRACKET_REGEX = /\[[^\]]*?\s*\]/;
const FIRST_CLOSING_BRACKET_REGEX = /\]/;

/**
 * Computes the number of characters back from the end of `expansionText`
 * to position the cursor right before the first `]`.
 */
export function computeOffsetFromFirstBracket(expansionText: string): number {
	const emptyFieldMatch = FIRST_EMPTY_BRACKET_REGEX.exec(expansionText);
	if (emptyFieldMatch && emptyFieldMatch.index !== undefined) {
		const bracketIndex = emptyFieldMatch.index + emptyFieldMatch[0].length - 1;
		return expansionText.length - bracketIndex;
	}

	const fallbackMatch = FIRST_CLOSING_BRACKET_REGEX.exec(expansionText);
	if (fallbackMatch && fallbackMatch.index !== undefined) {
		return expansionText.length - fallbackMatch.index;
	}

	return 0;
}

/**
 * Resolves the absolute document offset where the cursor should snap after schema expansion.
 * Uses `rule.cursorOffset` (characters back from the end of `expansionText`) when > 0,
 * or falls back to regex detection of the first empty bracket `]`.
 */
export function resolveCursorAnchor(tagStart: number, rule: SchemaRule): number {
	const len = rule.expansionText.length;

	if (rule.cursorOffset > 0 && rule.cursorOffset <= len) {
		return tagStart + (len - rule.cursorOffset);
	}

	const autoOffsetFromEnd = computeOffsetFromFirstBracket(rule.expansionText);
	if (autoOffsetFromEnd > 0 && autoOffsetFromEnd <= len) {
		return tagStart + (len - autoOffsetFromEnd);
	}

	return tagStart + len;
}

/**
 * Inspects a document change where a trigger character (Space or Tab) was just inserted.
 * If the text immediately preceding the trigger character matches a configured `SchemaRule`,
 * returns an atomic `TransactionSpec` that replaces the tag + trigger with `expansionText`
 * and snaps the cursor into the target field.
 */
export function buildExpansionTransaction(
	update: ViewUpdate,
	getSchemas: () => SchemaRule[]
): TransactionSpec | null {
	if (!update.docChanged) {
		return null;
	}

	for (const tr of update.transactions) {
		if (tr.annotation(schemaExpansionAnnotation)) {
			return null;
		}
		if (tr.isUserEvent("undo") || tr.isUserEvent("redo")) {
			return null;
		}
	}

	const schemas = getSchemas();
	if (!schemas || schemas.length === 0) {
		return null;
	}

	let expansionSpec: TransactionSpec | null = null;

	update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
		if (expansionSpec !== null) return;

		// Only trigger on a single inserted Space or Tab character
		if (fromA !== toA || inserted.length !== 1) return;
		const insertedChar = inserted.toString();
		if (insertedChar !== " " && insertedChar !== "\t") return;

		const line = update.state.doc.lineAt(toB);
		const offsetBeforeTrigger = fromB - line.from;
		const textBeforeTrigger = line.text.slice(0, offsetBeforeTrigger);

		for (const rawRule of schemas) {
			const triggerTag = rawRule.triggerTag.trim();
			const expansionText = rawRule.expansionText;
			if (!triggerTag || !expansionText) continue;

			if (!textBeforeTrigger.endsWith(triggerTag)) continue;

			// Ensure the tag starts at the beginning of the line or after whitespace
			const tagStartInLine = offsetBeforeTrigger - triggerTag.length;
			if (tagStartInLine > 0 && !/\s/.test(textBeforeTrigger[tagStartInLine - 1])) {
				continue;
			}

			const tagStart = line.from + tagStartInLine;
			const replaceTo = toB;
			const cursorAnchor = resolveCursorAnchor(tagStart, rawRule);

			expansionSpec = {
				changes: {
					from: tagStart,
					to: replaceTo,
					insert: expansionText,
				},
				selection: EditorSelection.cursor(cursorAnchor),
				annotations: [
					schemaExpansionAnnotation.of(true),
					Transaction.userEvent.of("input.complete"),
				],
			};
			break;
		}
	});

	return expansionSpec;
}

/**
 * CodeMirror 6 extension that monitors editor transactions and expands
 * matched trigger tags into inline schemas on Space or Tab.
 */
export function createSchemaExpanderExtension(
	getSchemas: () => SchemaRule[]
): Extension {
	return EditorView.updateListener.of((update: ViewUpdate) => {
		const spec = buildExpansionTransaction(update, getSchemas);
		if (spec) {
			update.view.dispatch(spec);
		}
	});
}
