/** Schemas, the starter set, and loading saved settings (including the 1.0 format). */
import { normalizeTag } from "./fields";

export interface SchemaRule {
	/** The tag that expands, e.g. `#case-law`. */
	triggerTag: string;
	/** What the tag expands into; see template.ts for the placeholder syntax. */
	expansionText: string;
	/** Fields that should be filled in; empty or missing ones are flagged in the editor. */
	requiredFields: string[];
	/** How "Insert citation" formats an entry, e.g. `*{{name}}* [{{year}}] {{citation}} ({{court}})`. */
	citationFormat: string;
	/** Where "Promote line to note" creates notes. Empty: beside the current note. */
	noteFolder: string;
	/** Headings a promoted note starts with. */
	noteSections: string[];
	/** Optional template note for promoted notes; replaces the generated headings. */
	noteTemplate: string;
}

export interface Starter {
	label: string;
	schema: SchemaRule;
}

export const STARTERS: Starter[] = [
	{
		label: "Case",
		schema: {
			triggerTag: "#case-law",
			expansionText: "#case-law [court:: ${UKSC|HL|PC|CA|HC}] [year:: ] [citation:: ] [ratio:: ]",
			requiredFields: ["ratio"],
			citationFormat: "*{{name}}* [{{year}}] {{citation}} ({{court}})",
			noteFolder: "Cases",
			noteSections: ["Facts", "Issue", "Held", "Ratio"],
			noteTemplate: "",
		},
	},
	{
		label: "Statute",
		schema: {
			triggerTag: "#statute",
			expansionText: "#statute [act:: ] [section:: ] [rule:: ]",
			requiredFields: ["rule"],
			citationFormat: "{{act}} s {{section}}",
			noteFolder: "Statutes",
			noteSections: ["Text", "Notes"],
			noteTemplate: "",
		},
	},
	{
		label: "Principle",
		schema: {
			triggerTag: "#principle",
			expansionText: "#principle [area:: ] [rule:: ] [authority:: ]",
			requiredFields: ["rule"],
			citationFormat: "{{name}} ({{authority}})",
			noteFolder: "Principles",
			noteSections: ["Rule", "Authorities", "Exceptions"],
			noteTemplate: "",
		},
	},
	{
		label: "Exam issue",
		schema: {
			triggerTag: "#exam-issue",
			expansionText: "#exam-issue [topic:: ] [rule:: ] [authorities:: ] [application:: ]",
			requiredFields: ["rule"],
			citationFormat: "{{name}}",
			noteFolder: "Exam issues",
			noteSections: ["Issue", "Rule", "Application", "Conclusion"],
			noteTemplate: "",
		},
	},
];

export function blankSchema(): SchemaRule {
	return {
		triggerTag: "#new-tag",
		expansionText: "#new-tag [field1:: ] [field2:: ]",
		requiredFields: [],
		citationFormat: "{{name}}",
		noteFolder: "",
		noteSections: [],
		noteTemplate: "",
	};
}

export function copySchema(s: SchemaRule): SchemaRule {
	return { ...s, requiredFields: [...s.requiredFields], noteSections: [...s.noteSections] };
}

export const DEFAULT_SCHEMAS: SchemaRule[] = [copySchema(STARTERS[0].schema)];

function stringList(v: unknown): string[] | null {
	if (!Array.isArray(v)) return null;
	return v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean);
}

/**
 * Keeps well-formed schemas from saved data. Options added after 1.0 (required fields, citation and
 * note settings) are filled in from the starter with the same tag, or left blank.
 */
export function loadSchemas(raw: unknown): SchemaRule[] | null {
	if (!raw || typeof raw !== "object" || !Array.isArray((raw as { schemas?: unknown }).schemas)) {
		return null;
	}
	const out: SchemaRule[] = [];
	for (const item of (raw as { schemas: unknown[] }).schemas) {
		if (!item || typeof item !== "object") continue;
		const r = item as Record<string, unknown>;
		if (typeof r.triggerTag !== "string" || typeof r.expansionText !== "string") continue;
		const starter = STARTERS.find((s) => normalizeTag(s.schema.triggerTag) === normalizeTag(r.triggerTag as string));
		const base = starter ? copySchema(starter.schema) : blankSchema();
		out.push({
			triggerTag: r.triggerTag,
			expansionText: r.expansionText,
			requiredFields: stringList(r.requiredFields) ?? base.requiredFields,
			citationFormat: typeof r.citationFormat === "string" ? r.citationFormat : base.citationFormat,
			noteFolder: typeof r.noteFolder === "string" ? r.noteFolder : base.noteFolder,
			noteSections: stringList(r.noteSections) ?? base.noteSections,
			noteTemplate: typeof r.noteTemplate === "string" ? r.noteTemplate : base.noteTemplate,
		});
	}
	return out;
}

/** Comma-separated text from settings to a clean list. */
export function parseList(text: string): string[] {
	return text.split(",").map((s) => s.trim()).filter(Boolean);
}
