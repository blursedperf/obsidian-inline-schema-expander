/** Line edits, citations and promoted-note text. Pure string functions. */
import { findTag, normalizeTag, parseFields, sanitizeValue } from "./fields";
import { entryValue, linePrefix, SchemaEntry } from "./instances";
import type { SchemaRule } from "./schema";
import { templateFields } from "./template";

/** Where new fields go: after the last field that follows the tag, or right after the tag. */
function insertionPoint(lineText: string, tagIndex: number, tag: string): number {
	const fields = parseFields(lineText, tagIndex);
	return fields.length > 0 ? fields[fields.length - 1].to : tagIndex + normalizeTag(tag).length;
}

/**
 * Adds `[key:: ]` for each of `keys` the line lacks, in the template's order: before the first
 * field that comes later in `keys`, or after the last field. Null when nothing is missing.
 */
export function addMissingFields(lineText: string, tag: string, keys: string[]): string | null {
	const tagIndex = findTag(lineText, tag);
	if (tagIndex === -1) return null;
	const order = keys.map((k) => k.toLowerCase());
	const have = new Set(parseFields(lineText, tagIndex).map((f) => f.keyLower));
	if (order.every((k) => have.has(k))) return null;
	let text = lineText;
	keys.forEach((key, i) => {
		if (have.has(order[i])) return;
		const fields = parseFields(text, tagIndex);
		const later = fields.find((f) => order.indexOf(f.keyLower) > i);
		if (later) {
			text = `${text.slice(0, later.from)}[${key}:: ] ${text.slice(later.from)}`;
		} else {
			const at = insertionPoint(text, tagIndex, tag);
			text = `${text.slice(0, at)} [${key}:: ]${text.slice(at)}`;
		}
		have.add(order[i]);
	});
	return text;
}

/** Applies addMissingFields to every one-line entry of `schema` in a note, outside code blocks. */
export function addMissingFieldsInText(text: string, schema: SchemaRule): { text: string; changed: number } {
	const keys = templateFields(schema.expansionText).map((f) => f.key);
	const lines = text.split("\n");
	let fence: string | null = null;
	let inFrontmatter = lines[0]?.trim() === "---";
	let changed = 0;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (inFrontmatter) {
			if (i > 0 && /^(---|\.\.\.)\s*\r?$/.test(line)) inFrontmatter = false;
			continue;
		}
		const fm = /^\s*(```+|~~~+)/.exec(line);
		if (fm) {
			if (!fence) fence = fm[1][0];
			else if (fm[1][0] === fence) fence = null;
			continue;
		}
		if (fence) continue;
		const cr = line.endsWith("\r") ? "\r" : "";
		const body = cr ? line.slice(0, -1) : line;
		const tagIndex = findTag(body, schema.triggerTag);
		if (tagIndex === -1) continue;
		// A line with only the tag marks a whole note; it gets no fields.
		if (!body.slice(0, tagIndex).trim() && parseFields(body, tagIndex).length === 0 && !body.slice(tagIndex + normalizeTag(schema.triggerTag).length).trim()) continue;
		const next = addMissingFields(body, schema.triggerTag, keys);
		if (next !== null) {
			lines[i] = next + cr;
			changed++;
		}
	}
	return { text: lines.join("\n"), changed };
}

/** Sets a field's value on the line, adding the field after the others when it is missing. */
export function setFieldInLine(lineText: string, tag: string, key: string, value: string): string {
	const clean = sanitizeValue(value);
	const tagIndex = findTag(lineText, tag);
	const fields = parseFields(lineText, Math.max(0, tagIndex));
	const f = fields.find((x) => x.keyLower === key.toLowerCase());
	if (f) {
		const keyEnd = lineText.indexOf("::", f.from) + 2;
		return lineText.slice(0, keyEnd) + " " + clean + lineText.slice(f.to - 1);
	}
	const at = tagIndex === -1 ? lineText.length : insertionPoint(lineText, tagIndex, tag);
	return lineText.slice(0, at) + ` [${key}:: ${clean}]` + lineText.slice(at);
}

/** Sets a `Key:: value` line's value, keeping its list marker and bold key. */
export function setFullLineField(lineText: string, value: string): string {
	const i = lineText.indexOf("::");
	return i === -1 ? lineText : `${lineText.slice(0, i + 2)} ${value.replace(/[\r\n]+/g, " ").trim()}`;
}

/**
 * Fills `{{name}}`, `{{note}}`, `{{tag}}` and `{{field}}` from an entry, then tidies what empty
 * fields leave behind: `[]`, `()`, `**`, doubled spaces.
 */
export function formatCitation(format: string, entry: SchemaEntry): string {
	const note = entry.path.split("/").pop()?.replace(/\.md$/i, "") ?? "";
	const filled = format.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, key: string) => {
		const k = key.toLowerCase();
		if (k === "note") return note;
		if (k === "tag") return entry.tag;
		return entryValue(entry, k);
	});
	let out = filled;
	for (let i = 0; i < 3; i++) {
		out = out
			.replace(/\[\s*\]/g, "")
			.replace(/\(\s*\)/g, "")
			.replace(/(\*{1,2}|_{1,2})\s*\1/g, "")
			.replace(/\s{2,}/g, " ")
			.replace(/\s+([,.;:)\]])/g, "$1")
			.replace(/([([])\s+/g, "$1");
	}
	return out.trim().replace(/^[,;:]\s*|\s*[,;:]$/g, "").trim();
}

/** A file name for a promoted note: the entry's name without characters files cannot hold. */
export function noteFileName(name: string): string {
	return name
		.replace(/[\\/:*?"<>|#^[\]]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^\.+/, "")
		.slice(0, 120)
		.trim();
}

/** Body of a promoted note: the template note with fields filled in, or one heading per section. */
export function promotedBody(schema: SchemaRule, entry: SchemaEntry, template: string | null, ctx: { date: string; time: string }): string {
	if (template !== null) {
		return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, key: string) => {
			const k = key.toLowerCase();
			if (k === "title" || k === "name") return entry.name;
			if (k === "date") return ctx.date;
			if (k === "time") return ctx.time;
			if (k === "tag") return entry.tag;
			const f = entry.fields.find((x) => x.keyLower === k);
			return f ? f.value : m;
		});
	}
	return schema.noteSections.map((s) => `## ${s}\n`).join("\n");
}

/** Properties for a promoted note: the tag and every schema field (numbers stay numbers). */
export function promotedProperties(schema: SchemaRule, entry: SchemaEntry): Record<string, string | number> {
	const props: Record<string, string | number> = {};
	const keys = templateFields(schema.expansionText).map((f) => f.key);
	for (const f of entry.fields) if (!keys.some((k) => k.toLowerCase() === f.keyLower)) keys.push(f.key);
	for (const key of keys) {
		const v = entryValue(entry, key);
		props[key] = /^\d+(\.\d+)?$/.test(v) ? Number(v) : v;
	}
	return props;
}

/** The line left behind after promoting: its list marker and a link to the new note. */
export function promotedLine(lineText: string, link: string): string {
	return linePrefix(lineText) + link;
}
