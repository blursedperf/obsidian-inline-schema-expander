import * as assert from "assert";
import { EditorState, Transaction, TransactionSpec } from "@codemirror/state";
import { ViewUpdate } from "@codemirror/view";
import {
	addMissingFields,
	addMissingFieldsInText,
	formatCitation,
	noteFileName,
	promotedBody,
	promotedLine,
	promotedProperties,
	setFieldInLine,
	setFullLineField,
} from "../src/edits";
import { endsWithTag, findTag, normalizeTag, parseFields, sanitizeValue } from "../src/fields";
import { cleanName, linePrefix, parseEntries, SchemaEntry } from "../src/instances";
import { DEFAULT_SCHEMAS, loadSchemas, parseList, SchemaRule, STARTERS } from "../src/schema";
import {
	buildExpansionTransaction,
	expandBeforeCursor,
	nextFieldTarget,
	previousFieldTarget,
} from "../src/schemaExpander";
import { rankEntries, shortFields } from "../src/search";
import { firstFieldSelection, nowContext, renderTemplate, templateFields } from "../src/template";

const ctx = { date: "2026-11-17", time: "09:30", title: "Torts" };
const caseLaw: SchemaRule = { ...DEFAULT_SCHEMAS[0], expansionText: "#case-law [court:: ] [year:: ] [ratio:: ]" };
const withChoices: SchemaRule = DEFAULT_SCHEMAS[0];
const statute: SchemaRule = STARTERS[1].schema;

function mockUpdate(prev: EditorState, tr: Transaction): ViewUpdate {
	return { docChanged: tr.docChanged, transactions: [tr], changes: tr.changes, state: tr.state, startState: prev } as unknown as ViewUpdate;
}

/** Applies a change to `doc`, then the expansion it triggers (if any). */
function type(doc: string, from: number, to: number, insert: string, userEvent = "input.type", schemas = [caseLaw]) {
	const state = EditorState.create({ doc });
	const tr = state.update({ changes: { from, to, insert }, annotations: Transaction.userEvent.of(userEvent) });
	const spec = buildExpansionTransaction(mockUpdate(state, tr), () => schemas, () => ctx);
	const after = spec ? tr.state.update(spec).state : tr.state;
	return { spec, doc: after.doc.toString(), sel: after.selection.main };
}

// ── fields ──────────────────────────────────────────────────────────────────
{
	const line = "Donoghue #case-law [court:: HL] [year::1932] [ratio:: ]";
	const f = parseFields(line);
	assert.deepStrictEqual(f.map((x) => [x.key, x.value]), [["court", "HL"], ["year", "1932"], ["ratio", ""]]);
	assert.strictEqual(line.slice(f[0].valueFrom, f[0].valueTo), "HL");
	assert.strictEqual(line.slice(f[1].valueFrom, f[1].valueTo), "1932");
	assert.strictEqual(line[f[2].valueFrom], "]", "empty field: cursor goes before ]");
	assert.strictEqual(line.slice(f[2].from, f[2].to), "[ratio:: ]");

	assert.strictEqual(findTag("Donoghue #case-law [court:: ]", "#case-law"), 9);
	assert.strictEqual(findTag("#Case-Law here", "case-law"), 0, "case-insensitive, # optional");
	assert.strictEqual(findTag("#case-law-notes", "#case-law"), -1);
	assert.strictEqual(findTag("abc#case-law", "#case-law"), -1);
	assert.strictEqual(findTag("x #case-law[court:: ]", "#case-law"), 2);
	assert.ok(endsWithTag("- #case-law", "#case-law"));
	assert.ok(!endsWithTag("x#case-law", "#case-law"));
	assert.strictEqual(normalizeTag(" Case-Law "), "#case-law");
	assert.strictEqual(sanitizeValue(" a [b]\nc "), "a (b) c");
}

// ── templates ───────────────────────────────────────────────────────────────
{
	const fields = templateFields(withChoices.expansionText);
	assert.deepStrictEqual(fields.map((f) => f.key), ["court", "year", "citation", "ratio"]);
	assert.deepStrictEqual(fields[0].choices, ["UKSC", "HL", "PC", "CA", "HC"]);
	assert.strictEqual(renderTemplate(withChoices.expansionText, ctx), "#case-law [court:: ] [year:: ] [citation:: ] [ratio:: ]");

	const t = "#note [date:: {{date}}] [kind:: ${seminar}] [about:: {{title}}]";
	assert.strictEqual(renderTemplate(t, ctx), "#note [date:: 2026-11-17] [kind:: seminar] [about:: Torts]");
	assert.strictEqual(templateFields(t)[1].defaultValue, "seminar");
	// The first field has a value here (the date), so it is selected.
	const r = renderTemplate("#x [kind:: ${seminar}] [b:: ]", ctx);
	const sel = firstFieldSelection(r);
	assert.strictEqual(r.slice(sel.anchor, sel.head), "seminar");
	assert.deepStrictEqual(nowContext("T", new Date(2026, 0, 5, 7, 4)), { date: "2026-01-05", time: "07:04", title: "T" });
}

// ── expanding ───────────────────────────────────────────────────────────────
{
	// Typed space after the tag
	let r = type("#case-law", 9, 9, " ");
	assert.strictEqual(r.doc, "#case-law [court:: ] [year:: ] [ratio:: ]");
	assert.strictEqual(r.sel.head, 19);

	// Typed tab in a list item
	r = type("  - #case-law", 13, 13, "\t");
	assert.strictEqual(r.doc, "  - #case-law [court:: ] [year:: ] [ratio:: ]");
	assert.strictEqual(r.sel.head, 23);

	// Choices template: placeholders never reach the note
	r = type("Donoghue v Stevenson #case-law", 30, 30, " ", "input.type", [withChoices]);
	assert.strictEqual(r.doc, "Donoghue v Stevenson #case-law [court:: ] [year:: ] [citation:: ] [ratio:: ]");

	// Obsidian's tag suggestion replaces "#case-l" with "#case-law " in one change
	r = type("Donoghue #case-l", 9, 16, "#case-law ", "");
	assert.ok(r.spec, "completion expands");
	assert.strictEqual(r.doc, "Donoghue #case-law [court:: ] [year:: ] [ratio:: ]");
	// ...or with no trailing space
	r = type("#case-l", 0, 7, "#case-law", "input.complete");
	assert.strictEqual(r.doc, "#case-law [court:: ] [year:: ] [ratio:: ]");

	// Typing the tag character by character never expands until the space
	assert.strictEqual(type("#case-la", 8, 8, "w").spec, null);
	// A completion of some other word after the tag does not expand it
	assert.strictEqual(type("#case-law negl", 10, 14, "negligence", "input.complete").spec, null);
	// Space inside an already expanded line does not expand it again
	assert.strictEqual(type("#case-law[court:: HL]", 9, 9, " ").spec, null);
	// Pastes of whole lines are left alone (they do not end with the tag)
	assert.strictEqual(type("", 0, 0, "Donoghue #case-law [court:: HL]", "input.paste").spec, null);
	// Multi-line inserts never expand
	assert.strictEqual(type("", 0, 0, "a\n#case-law ", "input.paste").spec, null);
	// #case-law-notes and abc#case-law are not the tag
	assert.strictEqual(type("#case-law-notes", 15, 15, " ").spec, null);
	assert.strictEqual(type("abc#case-law", 12, 12, " ").spec, null);

	// Undo never re-expands
	const expanded = EditorState.create({ doc: "#case-law [court:: ] [year:: ] [ratio:: ]" });
	const undo = expanded.update({ changes: { from: 0, to: expanded.doc.length, insert: "#case-law " }, annotations: Transaction.userEvent.of("undo") });
	assert.strictEqual(buildExpansionTransaction(mockUpdate(expanded, undo), () => [caseLaw]), null);

	// Tab right after the tag (Obsidian would indent a list line instead)
	const s = EditorState.create({ doc: "- #case-law", selection: { anchor: 11 } });
	const spec = expandBeforeCursor(s, [caseLaw], ctx) as TransactionSpec;
	assert.ok(spec);
	const after = s.update(spec).state;
	assert.strictEqual(after.doc.toString(), "- #case-law [court:: ] [year:: ] [ratio:: ]");
	assert.strictEqual(after.selection.main.head, 21);
	assert.strictEqual(expandBeforeCursor(EditorState.create({ doc: "- #case-law [court:: HL]", selection: { anchor: 11 } }), [caseLaw], ctx), null);
	assert.strictEqual(expandBeforeCursor(EditorState.create({ doc: "- plain", selection: { anchor: 7 } }), [caseLaw], ctx), null);
}

// ── Tab between fields ──────────────────────────────────────────────────────
{
	const line = "#case-law [court:: HL] [year:: ] [ratio:: ]";
	const year = line.indexOf("[year:: ]") + 8;
	const ratio = line.indexOf("[ratio:: ]") + 9;
	// From inside court: next empty is year
	assert.deepStrictEqual(nextFieldTarget(line, 20, [caseLaw]), { from: year, to: year });
	// From year: ratio
	assert.deepStrictEqual(nextFieldTarget(line, year, [caseLaw]), { from: ratio, to: ratio });
	// From ratio: wraps to year
	assert.deepStrictEqual(nextFieldTarget(line, ratio, [caseLaw]), { from: year, to: year });
	// All filled: normal Tab
	assert.strictEqual(nextFieldTarget("#case-law [court:: HL] [year:: 1932]", 20, [caseLaw]), null);
	// Not a schema line
	assert.strictEqual(nextFieldTarget("- [a:: ] [b:: ]", 3, [caseLaw]), null);
	// Shift+Tab: from ratio back to year, from year back to court (selecting "HL")
	assert.deepStrictEqual(previousFieldTarget(line, ratio, [caseLaw]), { from: year, to: year });
	const court = previousFieldTarget(line, year, [caseLaw])!;
	assert.strictEqual(line.slice(court.from, court.to), "HL");
	assert.strictEqual(previousFieldTarget(line, 20, [caseLaw]), null, "first field: normal Shift+Tab");
	// After the fields: the last one
	assert.deepStrictEqual(previousFieldTarget(line + " more", line.length + 3, [caseLaw]), { from: ratio, to: ratio });
}

// ── entries in a note ───────────────────────────────────────────────────────
const note = [
	"---",
	"tags: [torts]",
	"---",
	"# Negligence",
	"- [ ] [[Donoghue v Stevenson]] #case-law [court:: HL] [year:: 1932] [ratio:: A manufacturer owes a duty of care to the consumer] ^dvs",
	"## Remoteness",
	"#case-law [court:: PC] [year:: 1961]",
	"```",
	"Fake v Case #case-law [court:: X]",
	"```",
	"Occupiers' duty #statute [act:: Occupiers' Liability Act 1957] [section:: 2(1)]",
	"#case-law-notes are not entries",
].join("\n");
const entries = parseEntries(note, "Torts/Negligence.md", "Negligence", [caseLaw, statute], { tags: ["torts"] });
{
	assert.strictEqual(entries.length, 3);
	const [dvs, wagon, ola] = entries;
	assert.strictEqual(dvs.name, "Donoghue v Stevenson");
	assert.strictEqual(dvs.line, 4);
	assert.strictEqual(dvs.blockId, "dvs");
	assert.strictEqual(dvs.fields.find((f) => f.keyLower === "court")?.value, "HL");
	assert.strictEqual(wagon.name, "Remoteness", "no name before the tag: the heading above");
	assert.strictEqual(ola.tag, "#statute");
	assert.strictEqual(ola.name, "Occupiers' duty");

	// A note tagged in its properties, with fields from properties and Key:: lines
	const caseNote = "---\ntags: [case-law]\ncourt: HL\nyear: 1932\n---\n## Facts\n- **Ratio**:: Neighbour principle\nDuty of care :: not a field (flashcard)";
	const ne = parseEntries(caseNote, "Cases/Donoghue v Stevenson.md", "Donoghue v Stevenson", [caseLaw], { tags: ["case-law"], court: "HL", year: 1932 });
	assert.strictEqual(ne.length, 1);
	assert.strictEqual(ne[0].line, null);
	assert.strictEqual(ne[0].name, "Donoghue v Stevenson");
	assert.deepStrictEqual(ne[0].fields.map((f) => [f.keyLower, f.value]), [["court", "HL"], ["year", "1932"], ["ratio", "Neighbour principle"]]);
	// A line with only the tag marks the note too
	assert.strictEqual(parseEntries("#case-law\nRatio:: x", "a.md", "A", [caseLaw], null)[0].line, null);

	assert.strictEqual(cleanName("  - [x] [[Caparo|Caparo v Dickman]]: "), "Caparo v Dickman");
	assert.strictEqual(linePrefix("\t- [ ] Donoghue #case-law"), "\t- [ ] ");
	assert.strictEqual(linePrefix("1. Donoghue"), "1. ");
}

// ── search ──────────────────────────────────────────────────────────────────
{
	const caseNote: SchemaEntry = { tag: "#case-law", path: "Cases/Caparo.md", line: null, lineText: "", name: "Caparo v Dickman", fields: [{ key: "ratio", keyLower: "ratio", value: "Three-stage test for a duty of care" }], blockId: null };
	const all = [...entries, caseNote];
	const m = rankEntries(all, "manufacturer duty");
	assert.strictEqual(m[0].entry.name, "Donoghue v Stevenson");
	assert.strictEqual(m[0].field?.key, "ratio");
	assert.strictEqual(rankEntries(all, "caparo")[0].entry.name, "Caparo v Dickman");
	assert.strictEqual(rankEntries(all, "duty")[0].entry.name, "Occupiers' duty", "name matches outrank field matches");
	assert.strictEqual(rankEntries(all, "zzz").length, 0);
	assert.strictEqual(rankEntries(all, "").length, 4);
	assert.deepStrictEqual(shortFields(entries[0]), ["HL", "1932"]);
}

// ── citations ───────────────────────────────────────────────────────────────
{
	const fmt = DEFAULT_SCHEMAS[0].citationFormat;
	assert.strictEqual(formatCitation(fmt, entries[0]), "*Donoghue v Stevenson* [1932] (HL)");
	const withCite = { ...entries[0], fields: [...entries[0].fields, { key: "citation", keyLower: "citation", value: "AC 562" }] };
	assert.strictEqual(formatCitation(fmt, withCite), "*Donoghue v Stevenson* [1932] AC 562 (HL)");
	const bare = { ...entries[0], fields: [] };
	assert.strictEqual(formatCitation(fmt, bare), "*Donoghue v Stevenson*");
	assert.strictEqual(formatCitation(STARTERS[1].schema.citationFormat, entries[2]), "Occupiers' Liability Act 1957 s 2(1)");
	assert.strictEqual(formatCitation("{{name}} ({{note}})", entries[0]), "Donoghue v Stevenson (Negligence)");
}

// ── editing lines ───────────────────────────────────────────────────────────
{
	const keys = templateFields(withChoices.expansionText).map((f) => f.key);
	assert.strictEqual(addMissingFields("- Donoghue #case-law [court:: HL] [ratio:: x] ^id", "#case-law", keys), "- Donoghue #case-law [court:: HL] [year:: ] [citation:: ] [ratio:: x] ^id");
	assert.strictEqual(addMissingFields("A #case-law [ratio:: x] [extra:: y]", "#case-law", keys), "A #case-law [court:: ] [year:: ] [citation:: ] [ratio:: x] [extra:: y]");
	assert.strictEqual(addMissingFields("A #case-law [court:: HL] [extra:: y]", "#case-law", keys), "A #case-law [court:: HL] [extra:: y] [year:: ] [citation:: ] [ratio:: ]");
	assert.strictEqual(addMissingFields("#case-law", "#case-law", ["court"]), "#case-law [court:: ]");
	assert.strictEqual(addMissingFields("#case-law [court:: HL] [year:: ] [citation:: ] [ratio:: ]", "#case-law", keys), null);

	const text = "#case-law\n```\nA #case-law [court:: ]\n```\nB #case-law [court:: HL]\r\nC #statute [act:: ]";
	const r = addMissingFieldsInText(text, withChoices);
	assert.strictEqual(r.changed, 1, "only B: the marker line and the code block are left alone");
	assert.strictEqual(r.text, "#case-law\n```\nA #case-law [court:: ]\n```\nB #case-law [court:: HL] [year:: ] [citation:: ] [ratio:: ]\r\nC #statute [act:: ]");

	assert.strictEqual(setFieldInLine("A #case-law [court:: ] [year:: 1932]", "#case-law", "court", "HL"), "A #case-law [court:: HL] [year:: 1932]");
	assert.strictEqual(setFieldInLine("A #case-law [Court:: CA]", "#case-law", "court", "UKSC"), "A #case-law [Court:: UKSC]");
	assert.strictEqual(setFieldInLine("A #case-law [court:: HL] ^x", "#case-law", "ratio", "a [b]"), "A #case-law [court:: HL] [ratio:: a (b)] ^x");
	assert.strictEqual(setFullLineField("- **Ratio**:: old", "new"), "- **Ratio**:: new");
}

// ── promoting ───────────────────────────────────────────────────────────────
{
	assert.strictEqual(noteFileName("R v Brown [1994] 1 AC 212: consent?"), "R v Brown 1994 1 AC 212 consent");
	assert.strictEqual(promotedLine("\t- [ ] Donoghue #case-law [court:: HL]", "[[Donoghue]]"), "\t- [ ] [[Donoghue]]");
	assert.deepStrictEqual(promotedProperties(withChoices, entries[0]), {
		court: "HL",
		year: 1932,
		citation: "",
		ratio: "A manufacturer owes a duty of care to the consumer",
	});
	assert.strictEqual(promotedBody(withChoices, entries[0], null, ctx), "## Facts\n\n## Issue\n\n## Held\n\n## Ratio\n");
	assert.strictEqual(promotedBody(withChoices, entries[0], "# {{name}}\nCourt: {{court}} ({{date}}) {{unknown}}", ctx), "# Donoghue v Stevenson\nCourt: HL (2026-11-17) {{unknown}}");
}

// ── settings ────────────────────────────────────────────────────────────────
{
	assert.strictEqual(loadSchemas(null), null);
	assert.strictEqual(loadSchemas({ schemas: "nope" }), null);
	// 1.0 data: kept as written, newer options filled in from the matching starter
	const loaded = loadSchemas({
		schemas: [
			{ triggerTag: "#case-law", expansionText: "#case-law [court:: ] [year:: ] [ratio:: ]", cursorOffset: 22 },
			{ triggerTag: "#mine", expansionText: "#mine [a:: ]", cursorOffset: 0, extra: 1 },
			{ triggerTag: "#broken" },
			null,
		],
	})!;
	assert.strictEqual(loaded.length, 2);
	assert.strictEqual(loaded[0].expansionText, "#case-law [court:: ] [year:: ] [ratio:: ]");
	assert.deepStrictEqual(loaded[0].requiredFields, ["ratio"]);
	assert.strictEqual(loaded[0].noteFolder, "Cases");
	assert.deepStrictEqual(loaded[1], {
		triggerTag: "#mine",
		expansionText: "#mine [a:: ]",
		requiredFields: [],
		citationFormat: "{{name}}",
		noteFolder: "",
		noteSections: [],
		noteTemplate: "",
	});
	assert.ok(!("cursorOffset" in loaded[0]));
	assert.deepStrictEqual(parseList(" ratio, , held "), ["ratio", "held"]);
	// Defaults are copies: editing one never changes the starter
	assert.notStrictEqual(DEFAULT_SCHEMAS[0], STARTERS[0].schema);
}

console.log("All Inline Schema Expander tests passed!");
