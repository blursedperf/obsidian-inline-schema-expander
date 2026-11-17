/**
 * Inline fields (`[key:: value]`) and trigger tags on a single line of Markdown.
 * Pure string functions: no Obsidian or CodeMirror imports, so they are unit-tested directly.
 */

export interface InlineField {
	key: string;
	keyLower: string;
	/** The value with surrounding whitespace removed. */
	value: string;
	/** Position of the opening `[`. */
	from: number;
	/** Position just after the closing `]`. */
	to: number;
	/** Where the value starts: after `:: ` for an empty field, at the first character otherwise. */
	valueFrom: number;
	/** Where the value ends (equal to `valueFrom` for an empty field). */
	valueTo: number;
}

/** Parses every `[key:: value]` field in `text`, starting at `start`. */
export function parseFields(text: string, start = 0): InlineField[] {
	const re = /\[([^[\]\n:]+?)::([^[\]\n]*)\]/g;
	re.lastIndex = start;
	const out: InlineField[] = [];
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) {
		const key = m[1].trim();
		if (!key) continue;
		const from = m.index;
		const rawStart = from + 1 + m[1].length + 2;
		const raw = m[2];
		const value = raw.trim();
		const lead = raw.length - raw.trimStart().length;
		const valueFrom = value ? rawStart + lead : rawStart + Math.min(1, raw.length);
		out.push({
			key,
			keyLower: key.toLowerCase(),
			value,
			from,
			to: from + m[0].length,
			valueFrom,
			valueTo: value ? valueFrom + value.length : valueFrom,
		});
	}
	return out;
}

/** `#Case-Law` and `case-law` both become `#case-law`. */
export function normalizeTag(tag: string): string {
	const t = tag.trim().toLowerCase();
	if (!t) return "";
	return t.startsWith("#") ? t : `#${t}`;
}

/**
 * Index of `tag` in `text` as a whole tag: at the start or after whitespace, and followed by the end,
 * whitespace or a field. Tags compare case-insensitively, as in Obsidian. -1 when absent.
 */
export function findTag(text: string, tag: string): number {
	const t = normalizeTag(tag);
	if (!t) return -1;
	const lower = text.toLowerCase();
	let i = lower.indexOf(t);
	while (i !== -1) {
		const before = i === 0 ? " " : lower[i - 1];
		const after = lower[i + t.length] ?? " ";
		if (/\s/.test(before) && (/\s/.test(after) || after === "[")) return i;
		i = lower.indexOf(t, i + 1);
	}
	return -1;
}

/** True when `text` ends with `tag` as a whole tag (at the start or after whitespace). */
export function endsWithTag(text: string, tag: string): boolean {
	const t = normalizeTag(tag);
	if (!t || !text.toLowerCase().endsWith(t)) return false;
	const start = text.length - t.length;
	return start === 0 || /\s/.test(text[start - 1]);
}

/** Field values cannot hold brackets or line breaks without breaking the field. */
export function sanitizeValue(value: string): string {
	return value.replace(/[\r\n]+/g, " ").replace(/\[/g, "(").replace(/\]/g, ")").trim();
}

/** The field containing `pos` (between its brackets), if any. */
export function fieldAt(fields: InlineField[], pos: number): InlineField | undefined {
	return fields.find((f) => pos > f.from && pos < f.to);
}
