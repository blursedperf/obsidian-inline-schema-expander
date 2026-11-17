/**
 * Schema templates: the text a trigger tag expands into.
 *
 *   #case-law [court:: ${UKSC|HL|CA}] [year:: ] [ratio:: ]
 *
 * `${a|b|c}` offers a list of choices (the field starts empty), `${text}` fills in a default, and
 * `{{date}}`, `{{time}}` and `{{title}}` are replaced when the template expands.
 */
import { parseFields } from "./fields";

export interface TemplateField {
	key: string;
	keyLower: string;
	choices: string[];
	defaultValue: string;
}

export interface TemplateContext {
	date: string;
	time: string;
	title: string;
}

const PLACEHOLDER = /\$\{([^}]*)\}/g;

function parsePlaceholder(body: string): { choices: string[]; defaultValue: string } {
	if (body.includes("|")) {
		return { choices: body.split("|").map((c) => c.trim()).filter(Boolean), defaultValue: "" };
	}
	return { choices: [], defaultValue: body.trim() };
}

/** The fields a template defines, in order, with their choices and defaults. */
export function templateFields(template: string): TemplateField[] {
	const seen = new Set<string>();
	const out: TemplateField[] = [];
	for (const f of parseFields(template)) {
		if (seen.has(f.keyLower)) continue;
		seen.add(f.keyLower);
		const m = /^\$\{([^}]*)\}$/.exec(f.value);
		const { choices, defaultValue } = m ? parsePlaceholder(m[1]) : { choices: [], defaultValue: f.value };
		out.push({ key: f.key, keyLower: f.keyLower, choices, defaultValue });
	}
	return out;
}

/** Expands placeholders and variables into the text that is inserted. */
export function renderTemplate(template: string, ctx: TemplateContext): string {
	return template
		.replace(/\{\{\s*date\s*\}\}/gi, ctx.date)
		.replace(/\{\{\s*time\s*\}\}/gi, ctx.time)
		.replace(/\{\{\s*title\s*\}\}/gi, ctx.title)
		.replace(PLACEHOLDER, (_m, body: string) => parsePlaceholder(body).defaultValue);
}

/** Where the cursor goes after expanding: the first field's value (selected when it has a default). */
export function firstFieldSelection(rendered: string, after = 0): { anchor: number; head: number } {
	const f = parseFields(rendered, after)[0];
	if (!f) return { anchor: rendered.length, head: rendered.length };
	return { anchor: f.valueFrom, head: f.valueTo };
}

function pad(n: number): string {
	return String(n).padStart(2, "0");
}

/** Today's date (YYYY-MM-DD) and time (HH:mm), in local time. */
export function nowContext(title: string, now = new Date()): TemplateContext {
	return {
		date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
		time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
		title,
	};
}
