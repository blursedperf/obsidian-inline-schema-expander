/** Ranking schema entries for the search box. Pure, so it is unit-tested. */
import type { EntryField, SchemaEntry } from "./instances";

export interface EntryMatch {
	entry: SchemaEntry;
	score: number;
	/** The field (other than the name) where the query matched best, to show under the name. */
	field: EntryField | null;
}

function tokens(query: string): string[] {
	return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Every word of the query must appear in the entry's name, tag or a field value. Matches in the
 * name count most, then at the start of a word, then anywhere.
 */
export function rankEntries(entries: SchemaEntry[], query: string, limit = 100): EntryMatch[] {
	const words = tokens(query);
	const out: EntryMatch[] = [];
	for (const entry of entries) {
		const name = entry.name.toLowerCase();
		let score = 0;
		let ok = true;
		const fieldHits = new Map<EntryField, number>();
		for (const w of words) {
			let best = 0;
			if (name.startsWith(w)) best = 12;
			else if (new RegExp(`(^|[\\s(\\[-])${escapeRe(w)}`).test(name)) best = 9;
			else if (name.includes(w)) best = 6;
			if (entry.tag.includes(w)) best = Math.max(best, 3);
			for (const f of entry.fields) {
				const v = f.value.toLowerCase();
				if (!v) continue;
				const s = new RegExp(`(^|[\\s(\\[-])${escapeRe(w)}`).test(v) ? 4 : v.includes(w) ? 2 : f.keyLower === w ? 1 : 0;
				if (s > 0) fieldHits.set(f, (fieldHits.get(f) ?? 0) + s);
				best = Math.max(best, s);
			}
			if (best === 0) {
				ok = false;
				break;
			}
			score += best;
		}
		if (!ok) continue;
		let field: EntryField | null = null;
		let fieldScore = 0;
		for (const [f, s] of fieldHits) if (s > fieldScore) [field, fieldScore] = [f, s];
		out.push({ entry, score, field });
	}
	out.sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));
	return out.slice(0, limit);
}

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Short fields (court, year) shown beside the name; long ones (ratio) get their own line. */
export function shortFields(entry: SchemaEntry, max = 2): string[] {
	return entry.fields.filter((f) => f.value && f.value.length <= 24 && f.keyLower !== "name" && f.keyLower !== "case").slice(0, max).map((f) => f.value);
}

export function detailField(entry: SchemaEntry, matched: EntryField | null): EntryField | null {
	if (matched && matched.value.length > 24) return matched;
	return entry.fields.find((f) => f.value.length > 24) ?? matched;
}
