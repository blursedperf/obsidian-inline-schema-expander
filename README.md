# Inline Schema Expander

An Obsidian plugin that expands a trigger tag into an inline field template as you type, and puts the cursor in the first field. It brings Logseq-style "tags as classes" to Obsidian.

Type `#case-law` followed by a space and it becomes:

```markdown
#case-law [court:: ] [year:: ] [ratio:: ]
```

with the cursor inside `[court:: ]`, ready to fill in.

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
- [Whole-Tree Search](https://github.com/blursedperf/obsidian-whole-tree-search)

## Features

- **Trigger tags**: Each schema pairs a tag (e.g. `#case-law`) with the text it expands into. The expansion happens when the tag is followed by a space or tab, and only when the tag starts the line or follows whitespace, so `#case-law-notes` or `abc#case-law` never expand.
- **Cursor placement**: By default the cursor goes into the first empty field (`[field:: ]`). Set a cursor offset to place it a fixed number of characters back from the end instead.
- **Inline fields**: Expansions use `[key:: value]` inline fields, which Dataview and similar plugins can query.
- **Undo-friendly**: Undo and redo never re-trigger an expansion.
- **Works with Pomodoro Flashcards**: Filled-in `#case-law` lines become case cards automatically in [Pomodoro Flashcards](https://github.com/blursedperf/obsidian-pomodoro-flashcards).

## Settings

Open **Settings → Community plugins → Inline Schema Expander**.

| Setting | Description |
| --- | --- |
| **Add new schema** | Adds a schema with a starter template. |
| **Trigger tag** | Tag that triggers the expansion, e.g. `#case-law`. |
| **Expansion text** | Text that replaces the tag, e.g. `#case-law [court:: ] [year:: ] [ratio:: ]`. |
| **Cursor offset** | Characters back from the end of the expansion to place the cursor. `0` places it in the first empty field. |

Each schema also has buttons to recalculate the cursor offset from the first empty field and to delete the schema.

## Privacy & Security

- **Zero network activity**: The plugin makes no network requests, contacts no servers, and collects no telemetry.
- **Offline audit**: Every test run checks the source, built bundle and styles with `scripts/offline-audit.mjs`, which fails on any network API (`fetch`, `XMLHttpRequest`, WebSocket, `requestUrl`, workers, dynamic `import()`, ...), dynamic code (`eval`, `new Function`), raw HTML injection, or remote CSS.
- **Local only**: Schemas are stored in the vault's `.obsidian/plugins/inline-schema-expander/data.json`. The plugin only edits the line you are typing on.

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
