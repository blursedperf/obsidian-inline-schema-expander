import * as assert from "assert";
import { EditorState, Transaction } from "@codemirror/state";
import { ViewUpdate } from "@codemirror/view";
import {
	buildExpansionTransaction,
	computeOffsetFromFirstBracket,
	DEFAULT_SCHEMAS,
	loadSchemas,
	resolveCursorAnchor,
	SchemaRule,
} from "../src/schemaExpander";

// Helper to simulate a ViewUpdate from a state transition
function createMockViewUpdate(
	prevState: EditorState,
	tr: Transaction
): ViewUpdate {
	return {
		docChanged: tr.docChanged,
		transactions: [tr],
		changes: tr.changes,
		state: tr.state,
		startState: prevState,
	} as unknown as ViewUpdate;
}

const caseLawSchema: SchemaRule = DEFAULT_SCHEMAS[0];

// Test 1: Offset calculation from first bracket and explicit cursorOffset
const expectedExpansion = "#case-law [court:: ] [year:: ] [ratio:: ]";
const offsetFromEnd = computeOffsetFromFirstBracket(expectedExpansion);
// "#case-law [court:: " is 19 chars, total length is 41 -> 41 - 19 = 22 chars from end
assert.strictEqual(offsetFromEnd, 22);

// Explicit cursorOffset = 22
assert.strictEqual(resolveCursorAnchor(0, caseLawSchema), 19);
assert.strictEqual(
	expectedExpansion.slice(0, resolveCursorAnchor(0, caseLawSchema)),
	"#case-law [court:: "
);

// Auto regex fallback when cursorOffset = 0
assert.strictEqual(
	resolveCursorAnchor(10, { ...caseLawSchema, cursorOffset: 0 }),
	10 + 19
);

// Test 2: Triggering expansion when space is typed after #case-law
const state1 = EditorState.create({ doc: "#case-law" });
const trSpace = state1.update({
	changes: { from: 9, to: 9, insert: " " },
	 annotations: Transaction.userEvent.of("input.type"),
});
const update1 = createMockViewUpdate(state1, trSpace);
const expansionSpec1 = buildExpansionTransaction(update1, () => [caseLawSchema]);

assert.ok(expansionSpec1, "Expected expansion transaction spec to be generated");
const expandedState1 = trSpace.state.update(expansionSpec1!).state;
assert.strictEqual(
	expandedState1.doc.toString(),
	"#case-law [court:: ] [year:: ] [ratio:: ]"
);
assert.strictEqual(expandedState1.selection.main.head, 19);

// Test 3: Triggering expansion inside an indented list item with Tab
const state2 = EditorState.create({ doc: "  - #case-law" });
const trTab = state2.update({
	changes: { from: 13, to: 13, insert: "\t" },
	annotations: Transaction.userEvent.of("input.type"),
});
const update2 = createMockViewUpdate(state2, trTab);
const expansionSpec2 = buildExpansionTransaction(update2, () => [caseLawSchema]);

assert.ok(expansionSpec2, "Expected expansion on Tab inside list item");
const expandedState2 = trTab.state.update(expansionSpec2!).state;
assert.strictEqual(
	expandedState2.doc.toString(),
	"  - #case-law [court:: ] [year:: ] [ratio:: ]"
);
// "  - " is 4 chars + 19 chars = 23
assert.strictEqual(expandedState2.selection.main.head, 23);

// Test 4: Undo transaction must NOT re-trigger expansion
const trUndo = expandedState1.update({
	changes: {
		from: 0,
		to: expandedState1.doc.length,
		insert: "#case-law ",
	},
	annotations: Transaction.userEvent.of("undo"),
});
const updateUndo = createMockViewUpdate(expandedState1, trUndo);
const undoExpansionSpec = buildExpansionTransaction(updateUndo, () => [caseLawSchema]);
assert.strictEqual(
	undoExpansionSpec,
	null,
	"Undo transaction must not re-trigger schema expansion"
);


// Saved settings: only well-formed schemas are kept; missing or broken data falls back to defaults
assert.deepStrictEqual(loadSchemas(null), null);
assert.deepStrictEqual(loadSchemas({ schemas: "nope" }), null);
assert.deepStrictEqual(
	loadSchemas({
		schemas: [
			{ triggerTag: "#statute", expansionText: "#statute [act:: ] [section:: ]", cursorOffset: 0, extra: 1 },
			{ triggerTag: "#broken" },
			null,
		],
	}),
	[{ triggerTag: "#statute", expansionText: "#statute [act:: ] [section:: ]", cursorOffset: 0 }]
);

console.log("All Inline Schema Expander tests passed!");
