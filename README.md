# Inline Schema Expander

An Obsidian plugin that turns tags into small records you can fill in quickly and look up later. It brings Logseq-style "tags as classes" to Obsidian.

Type `#case-law` followed by a space and it becomes:

```markdown
#case-law [court:: ] [year:: ] [citation:: ] [ratio:: ]
```

with the cursor in `court`, a list of courts to pick from, and Tab to move on to `year`. Every `#case-law` line in the vault can then be searched, cited, viewed as a table, or promoted to a note of its own.

## Why this suite exists

I created this suite of Obsidian plugins and the DoomEsque theme so that I can be 100 percent certain there are no network calls or traffic: everything runs 100 percent offline, so I can use Obsidian for my notes in open-book law exams.

- Nothing in the suite makes a network request. Every test run checks the source, built bundle and styles with `scripts/offline-audit.mjs`, which fails on any network API (`fetch`, `XMLHttpRequest`, WebSocket, `requestUrl`, ...).
- Obsidian itself has separate online features. For a fully offline setup, also turn off automatic updates, Sync and Publish, and don't browse community plugins during the exam.

The suite:

- [DoomEsque](https://github.com/blursedperf/obsidian-theme-doomesque) (theme)
- [DoomEsque Settings](https://github.com/blursedperf/obsidian-doomesque-settings)
- [Filetypes](https://github.com/blursedperf/obsidian-filetypes-plugin)
- [Inline Autocomplete](https://github.com/blursedperf/obsidian-inline-autocomplete)
- **Inline Schema Expander**
- [Links in New Tabs](https://github.com/blursedperf/obsidian-links-in-new-tabs)
- [Pomodoro Flashcards](https://github.com/blursedperf/obsidian-pomodoro-flashcards)
- [Task Docket](https://github.com/blursedperf/obsidian-task-docket)
- [Whole-Tree Search](https://github.com/blursedperf/obsidian-whole-tree-search)

## Features

### Filling in entries

- **Trigger tags**: Each schema pairs a tag (e.g. `#case-law`) with the template it expands into. The tag expands when followed by a space or Tab, when you pick it from Obsidian's tag suggestions, or when Inline Autocomplete completes it, including on list lines. `#case-law-notes` or `abc#case-law` never expand, and neither does a line that already has the schema's fields.
- **Tab between fields**: On a schema line, Tab jumps to the next empty field and Shift+Tab to the previous field. Once every field is filled, Tab indents as usual. (When Inline Autocomplete shows ghost text, Tab accepts it first.)
- **Choices and defaults**: In a template, `[court:: ${UKSC|HL|CA}]` offers those courts while the cursor is in the field, `[kind:: ${seminar}]` fills in a default (selected, so typing replaces it), and `{{date}}`, `{{time}}` and `{{title}}` are filled in.
- **Earlier values**: Short fields such as court or year also suggest the values you have used before, most used first.
- **Required fields**: Empty fields are shaded, and required ones are underlined. A line missing a required field altogether shows a `+ ratio` button that adds it. Pomodoro Flashcards skips empty fields, so this is how you spot a case that will not make cards.
- **Undo-friendly**: Undo and redo never re-trigger an expansion.

### Using entries

- **Find entry**: Search every entry by its name or any field, e.g. `manufacturer duty` finds *Donoghue v Stevenson* from its ratio. Enter opens the line, Shift+Enter inserts the entry's citation at the cursor, and Alt+Enter inserts a link.
- **Insert citation**: The same search, where Enter inserts a citation such as `*Donoghue v Stevenson* [1932] AC 562 (HL)`. Each schema has its own citation format; brackets left empty by missing fields are dropped.
- **Schema table**: One schema's entries as a table you can sort by any column and filter. Click a value to edit it; the change is written back to the note. Open it from the ribbon or with **Open schema table**.
- **Promote line to note**: Turns `Donoghue v Stevenson #case-law [...]` into the note `Cases/Donoghue v Stevenson`, with the tag and fields as properties and headings such as Facts, Issue, Held and Ratio (or a template note of your own), and leaves a link in place of the line.
- **Add missing fields to existing lines**: After adding a field to a template, add it to every earlier line that lacks it, in template order. You see how many lines and notes change before anything is written.
- **Whole notes count too**: A note tagged `case-law` in its properties (or with a line that is just `#case-law`) is an entry, with its fields from properties and `Field:: value` lines, as Pomodoro Flashcards reads it.
- **Starter schemas**: Case, statute, principle and exam issue, each with sensible fields, a citation format and note headings. Add your own from scratch.
- **Inline fields**: Entries are plain `[key:: value]` inline fields, which Dataview and Pomodoro Flashcards also read.

## Commands

| Command | What it does |
| --- | --- |
| **Find entry** | Search all entries; open one, or insert its citation or a link. |
| **Insert citation** | Search all entries and insert the chosen one's citation. |
| **Open schema table** | Open the table view (also in the ribbon). |
| **Promote line to note** | Make the entry on the cursor's line a note of its own. |
| **Add missing fields to existing lines** | Bring earlier lines up to date with a schema's template. |

## Settings

Open **Settings → Community plugins → Inline Schema Expander**.

| Setting | Description |
| --- | --- |
| **Tab moves between fields** | Tab and Shift+Tab move between a schema line's fields. |
| **Highlight empty fields** | Shade empty fields, flag required ones, and show a button for a missing required field. |
| **Suggest values** | Suggest a field's choices and earlier values while typing in it. |
| **Add schema** | Add a starter schema (case, statute, principle, exam issue) or a blank one. |
| **Trigger tag** | Tag that triggers the expansion, e.g. `#case-law`. |
| **Template** | What the tag expands into, with `${a\|b}` choices, `${text}` defaults and `{{date}}`, `{{time}}`, `{{title}}`. |
| **Required fields** | Fields flagged while empty or missing. |
| **Citation format** | How Insert citation formats an entry: `{{name}}` and any `{{field}}`. |
| **Note folder** | Where promoted notes are created (empty: beside the current note). |
| **Note sections** | Headings a promoted note starts with. |
| **Note template** | A note to copy for promoted notes instead of the headings. |

Each schema's heading has buttons to add its fields to existing lines and to delete it. Settings from version 1.0 keep working: the old cursor offset is no longer needed, as the cursor always starts in the first field.

## Privacy & Security

- **Zero network activity**: The plugin makes no network requests, contacts no servers, and collects no telemetry.
- **Offline audit**: Every test run checks the source, built bundle and styles with `scripts/offline-audit.mjs`, which fails on any network API (`fetch`, `XMLHttpRequest`, WebSocket, `requestUrl`, workers, dynamic `import()`, ...), dynamic code (`eval`, `new Function`), raw HTML injection, or remote CSS.
- **Local only**: Schemas are stored in the vault's `.obsidian/plugins/inline-schema-expander/data.json`. The plugin edits notes only when you ask it to: expanding a tag on the line you are typing, a value you change in the table, a line you promote, or the fields you confirm adding to existing lines.

## Installation

### Beta testing with BRAT

1. Install the [BRAT](https://github.com/TfTHacker/obsidian-42-brat) plugin.
2. Run **BRAT: Add a beta plugin for testing**.
3. Enter `blursedperf/obsidian-inline-schema-expander`.
4. Enable **Inline Schema Expander** in **Settings → Community plugins**.

### Manual installation

1. Download `main.js`, `manifest.json` and `styles.css` from the latest [GitHub release](https://github.com/blursedperf/obsidian-inline-schema-expander/releases).
2. Create the folder `<vault>/.obsidian/plugins/inline-schema-expander/`.
3. Copy the downloaded files into that folder.
4. Reload Obsidian and enable **Inline Schema Expander** in **Settings → Community plugins**.

## Development

```bash
npm install
npm test        # unit tests and the offline audit
npm run build   # type-check and bundle main.js
```

## License

[MIT](LICENSE) © 2026 blursedperf
