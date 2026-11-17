/**
 * Finding schema entries in a note: one-line entries (`Donoghue v Stevenson #case-law [court:: HL]`)
 * and whole notes tagged with a schema's tag (fields from properties and `Field:: value` lines).
 * Pure: the index feeds it file text and front matter.
 */
import { findTag, normalizeTag, parseFields } from "./fields";
import type { SchemaRule } from "./schema";

export interface EntryField {
	key: string;
	keyLower: string;
	value: string;
}

export interface SchemaEntry {
	/** Normalised tag, e.g. `#case-law`. */
	tag: string;
	path: string;
	/** 0-based line of a one-line entry; null for a whole-note entry. */
	line: number | null;
	/** The line as written (one-line entries), used to find it again before editing. */
	lineText: string;
	name: string;
	fields: EntryField[];
	/** `^block-id` at the end of the line, if any. */
	blockId: string | null;
}

const FULL_LINE_FIELD = /^\s*(?:[-*+]\s+)?(?:\*\*|__)?([A-Za-z][\w -]*?[\w-])(?:\*\*|__)?::\s*(.*)$/;
const IGNORED_PROPERTIES = new Set(["tags", "tag", "aliases", "alias", "cssclasses", "cssclass", "position"]);

/** `- [ ] Donoghue v [[Stevenson]]` -> `Donoghue v Stevenson`. */
export function cleanName(text: string): string {
	return text
		.replace(/^\s*>+\s*/, "")
		.replace(/^\s*#{1,6}\s+/, "")
		.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
		.replace(/^\[.\]\s+/, "")
		.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/[:\-–—,;]+$/, "")
		.trim();
}

/** Leading indent, list marker and checkbox, kept when a line is replaced. */
export function linePrefix(text: string): string {
	return /^(\s*(?:>\s*)*(?:(?:[-*+]|\d+[.)])\s+)?(?:\[.\]\s+)?)/.exec(text)?.[1] ?? "";
}

function fieldValue(fields: EntryField[], ...keys: string[]): string {
	for (const k of keys) {
		const f = fields.find((x) => x.keyLower === k && x.value);
		if (f) return f.value;
	}
	return "";
}

function propertyText(v: unknown): string {
	if (v === null || v === undefined) return "";
	if (Array.isArray(v)) return v.map(propertyText).filter(Boolean).join(", ");
	if (typeof v === "string") return v.trim();
	if (typeof v === "number" || typeof v === "boolean") return String(v);
	return "";
}

function frontmatterTags(fm: Record<string, unknown> | null | undefined): Set<string> {
	const out = new Set<string>();
	if (!fm) return out;
	for (const key of ["tags", "tag"]) {
		const v = fm[key];
		const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\s]+/) : [];
		for (const t of list) if (typeof t === "string" && t.trim()) out.add(normalizeTag(t));
	}
	return out;
}

export function parseEntries(
	text: string,
	path: string,
	basename: string,
	schemas: SchemaRule[],
	frontmatter?: Record<string, unknown> | null
): SchemaEntry[] {
	const tags = [...new Set(schemas.map((s) => normalizeTag(s.triggerTag)).filter(Boolean))];
	if (tags.length === 0) return [];
	const lines = text.split("\n");
	const out: SchemaEntry[] = [];
	const noteTags = frontmatterTags(frontmatter);
	const lineFields: EntryField[] = [];

	let inFrontmatter = lines[0]?.trim() === "---";
	let fence: string | null = null;
	let heading = "";

	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		const lineText = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
		if (inFrontmatter) {
			if (i > 0 && /^(---|\.\.\.)\s*$/.test(lineText)) inFrontmatter = false;
			continue;
		}
		const fenceMatch = /^\s*(```+|~~~+)/.exec(lineText);
		if (fenceMatch) {
			if (!fence) fence = fenceMatch[1][0];
			else if (fenceMatch[1][0] === fence) fence = null;
			continue;
		}
		if (fence) continue;

		const h = /^#{1,6}\s+(.*)$/.exec(lineText);
		if (h) heading = cleanName(h[1]);

		const full = FULL_LINE_FIELD.exec(lineText);
		if (full) lineFields.push({ key: full[1].trim(), keyLower: full[1].trim().toLowerCase(), value: full[2].trim() });

		let best = -1;
		let bestTag = "";
		for (const t of tags) {
			const idx = findTag(lineText, t);
			if (idx !== -1 && (best === -1 || idx < best)) {
				best = idx;
				bestTag = t;
			}
		}
		if (best === -1) continue;

		const before = lineText.slice(0, best);
		const fields = parseFields(lineText, best).map((f) => ({ key: f.key, keyLower: f.keyLower, value: f.value }));
		const afterTag = lineText.slice(best + bestTag.length).replace(/\^[\w-]+\s*$/, "").trim();
		// A line holding only the tag marks the whole note, like a tag in its properties.
		if (!cleanName(before) && fields.length === 0 && !afterTag) {
			noteTags.add(bestTag);
			continue;
		}
		const name = cleanName(before) || fieldValue(fields, "name", "case") || heading || basename;
		out.push({
			tag: bestTag,
			path,
			line: i,
			lineText,
			name,
			fields,
			blockId: /\s\^([\w-]+)\s*$/.exec(lineText)?.[1] ?? null,
		});
	}

	for (const t of tags) {
		if (!noteTags.has(t)) continue;
		const fields: EntryField[] = [];
		const seen = new Set<string>();
		for (const [key, v] of Object.entries(frontmatter ?? {})) {
			const keyLower = key.toLowerCase();
			if (IGNORED_PROPERTIES.has(keyLower) || seen.has(keyLower)) continue;
			seen.add(keyLower);
			fields.push({ key, keyLower, value: propertyText(v) });
		}
		for (const f of lineFields) {
			if (seen.has(f.keyLower)) continue;
			seen.add(f.keyLower);
			fields.push(f);
		}
		out.push({
			tag: t,
			path,
			line: null,
			lineText: "",
			name: fieldValue(fields, "name", "case") || basename,
			fields,
			blockId: null,
		});
	}
	return out;
}

export function entryValue(entry: SchemaEntry, key: string): string {
	const k = key.toLowerCase();
	if (k === "name") return entry.fields.find((f) => f.keyLower === "name" && f.value)?.value ?? entry.name;
	return entry.fields.find((f) => f.keyLower === k)?.value ?? "";
}
