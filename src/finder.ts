/** Search box over every schema entry in the vault: open one, or insert its citation or a link. */
import { App, Editor, Keymap, Platform, SuggestModal } from "obsidian";
import type InlineSchemaExpanderPlugin from "./main";
import { detailField, EntryMatch, rankEntries, shortFields } from "./search";

export type FinderMode = "open" | "cite";

export class EntryFinderModal extends SuggestModal<EntryMatch> {
	constructor(
		app: App,
		private readonly plugin: InlineSchemaExpanderPlugin,
		private readonly mode: FinderMode,
		private readonly editor: Editor | null,
		private readonly sourcePath: string
	) {
		super(app);
		this.limit = 100;
		this.modalEl.addClass("ise-finder");
		this.setPlaceholder(mode === "cite" ? "Find an entry to cite…" : "Search by name or any field, e.g. manufacturer duty…");
		const canInsert = !!editor;
		this.setInstructions(
			mode === "cite"
				? [
						{ command: "↑↓", purpose: "to navigate" },
						{ command: "↵", purpose: "to insert citation" },
						{ command: "alt ↵", purpose: "to insert link" },
						{ command: "esc", purpose: "to dismiss" },
					]
				: [
						{ command: "↑↓", purpose: "to navigate" },
						{ command: "↵", purpose: "to open" },
						{ command: "mod ↵", purpose: "to open in new tab" },
						...(canInsert && !Platform.isMobile
							? [
									{ command: "shift ↵", purpose: "to insert citation" },
									{ command: "alt ↵", purpose: "to insert link" },
								]
							: []),
						{ command: "esc", purpose: "to dismiss" },
					]
		);
		// Obsidian only sends plain and mod Enter to onChooseSuggestion; pass the other modifiers on.
		for (const mod of ["Shift", "Alt"] as const) {
			this.scope.register([mod], "Enter", (evt) => {
				const chooser = (this as unknown as { chooser?: { useSelectedItem?: (e: KeyboardEvent) => boolean } }).chooser;
				chooser?.useSelectedItem?.(evt);
				return false;
			});
		}
	}

	onOpen(): void {
		void super.onOpen();
		void this.plugin.index.whenReady().then(() => {
			// Refresh results once the index has finished its first build.
			this.inputEl.dispatchEvent(new Event("input"));
		});
	}

	getSuggestions(query: string): EntryMatch[] {
		return rankEntries(this.plugin.index.entries(), query, this.limit);
	}

	renderSuggestion(match: EntryMatch, el: HTMLElement): void {
		const { entry } = match;
		el.addClass("ise-finder-item");
		const top = el.createDiv({ cls: "ise-finder-top" });
		top.createSpan({ cls: "ise-finder-name", text: entry.name });
		const meta = shortFields(entry);
		if (meta.length > 0) top.createSpan({ cls: "ise-finder-meta", text: meta.join(" · ") });
		top.createSpan({ cls: "ise-finder-tag", text: entry.tag });
		const detail = detailField(entry, match.field);
		if (detail) {
			const d = el.createDiv({ cls: "ise-finder-detail" });
			d.createSpan({ cls: "ise-finder-key", text: `${detail.key}: ` });
			d.createSpan({ text: detail.value });
		}
		const where = entry.path.replace(/\.md$/i, "") + (entry.line !== null ? `:${entry.line + 1}` : "");
		el.createDiv({ cls: "ise-finder-path", text: where });
	}

	onNoSuggestion(): void {
		super.onNoSuggestion();
		const empty = this.resultContainerEl.querySelector(".suggestion-empty");
		if (empty && this.plugin.index.entries().length === 0) {
			empty.setText(`No entries yet. Type a schema tag such as ${this.plugin.settings.schemas[0]?.triggerTag ?? "#case-law"} followed by a space in any note.`);
		}
	}

	onChooseSuggestion(match: EntryMatch, evt: MouseEvent | KeyboardEvent): void {
		const insertLink = evt.altKey;
		const insertCitation = this.mode === "cite" || evt.shiftKey;
		if (this.editor && (insertLink || insertCitation)) {
			const text = insertLink ? this.plugin.linkFor(match.entry, this.sourcePath) : this.plugin.citationFor(match.entry);
			this.editor.replaceSelection(text);
			this.editor.focus();
			return;
		}
		void this.plugin.openEntry(match.entry, Keymap.isModEvent(evt));
	}
}
