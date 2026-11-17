/** A sortable, filterable table of one schema's entries, with values edited in place. */
import { ItemView, Keymap, setIcon, WorkspaceLeaf } from "obsidian";
import { normalizeTag } from "./fields";
import { entryValue, SchemaEntry } from "./instances";
import type InlineSchemaExpanderPlugin from "./main";
import { rankEntries } from "./search";
import { templateFields } from "./template";

export const TABLE_VIEW = "inline-schema-table";

interface Column {
	key: string;
	label: string;
	editable: boolean;
}

export class SchemaTableView extends ItemView {
	private tag = "";
	private filter = "";
	private sortKey = "name";
	private sortDesc = false;
	private editing = false;
	private pendingRender = false;
	private bodyEl!: HTMLElement;
	private countEl!: HTMLElement;
	private selectEl!: HTMLSelectElement;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: InlineSchemaExpanderPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return TABLE_VIEW;
	}

	getDisplayText(): string {
		return this.tag ? `Schema table: ${this.tag}` : "Schema table";
	}

	getIcon(): string {
		return "table";
	}

	getState(): Record<string, unknown> {
		return { tag: this.tag, sortKey: this.sortKey, sortDesc: this.sortDesc };
	}

	async setState(state: unknown, result: Parameters<ItemView["setState"]>[1]): Promise<void> {
		const s = (state ?? {}) as { tag?: unknown; sortKey?: unknown; sortDesc?: unknown };
		if (typeof s.tag === "string") this.tag = s.tag;
		if (typeof s.sortKey === "string") this.sortKey = s.sortKey;
		if (typeof s.sortDesc === "boolean") this.sortDesc = s.sortDesc;
		await super.setState(state, result);
		this.renderToolbar();
		this.renderTable();
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("ise-table-view");
		const toolbar = this.contentEl.createDiv({ cls: "ise-table-toolbar" });
		this.selectEl = toolbar.createEl("select", { cls: "dropdown", attr: { "aria-label": "Schema" } });
		this.selectEl.addEventListener("change", () => {
			this.tag = this.selectEl.value;
			this.sortKey = "name";
			this.sortDesc = false;
			this.renderTable();
			this.app.workspace.requestSaveLayout();
		});
		const search = toolbar.createDiv({ cls: "search-input-container ise-table-search" });
		const input = search.createEl("input", { type: "search", attr: { placeholder: "Filter entries…", "aria-label": "Filter entries" } });
		input.addEventListener("input", () => {
			this.filter = input.value;
			this.renderTable();
		});
		this.countEl = toolbar.createSpan({ cls: "ise-table-count" });
		this.bodyEl = this.contentEl.createDiv({ cls: "ise-table-scroll" });

		this.registerEvent(this.plugin.index.on("updated", () => this.renderTable()));
		this.renderToolbar();
		await this.plugin.index.whenReady();
		this.renderTable();
	}

	/** Called when schemas change in settings. */
	refresh(): void {
		this.renderToolbar();
		this.renderTable();
	}

	private renderToolbar(): void {
		if (!this.selectEl) return;
		const schemas = this.plugin.settings.schemas;
		this.selectEl.empty();
		for (const s of schemas) this.selectEl.createEl("option", { value: normalizeTag(s.triggerTag), text: s.triggerTag });
		if (!schemas.some((s) => normalizeTag(s.triggerTag) === normalizeTag(this.tag))) this.tag = schemas[0] ? normalizeTag(schemas[0].triggerTag) : "";
		this.selectEl.value = normalizeTag(this.tag);
	}

	private columns(entries: SchemaEntry[]): Column[] {
		const schema = this.plugin.schemaFor(this.tag);
		const cols: Column[] = [{ key: "name", label: "Name", editable: false }];
		const seen = new Set(["name"]);
		const add = (key: string) => {
			const k = key.toLowerCase();
			if (seen.has(k) || k === "case") return;
			seen.add(k);
			cols.push({ key, label: key.charAt(0).toUpperCase() + key.slice(1), editable: true });
		};
		if (schema) for (const f of templateFields(schema.expansionText)) add(f.key);
		for (const e of entries) for (const f of e.fields) add(f.key);
		cols.push({ key: "__note", label: "Note", editable: false });
		return cols;
	}

	private sorted(entries: SchemaEntry[]): SchemaEntry[] {
		const key = this.sortKey;
		const value = (e: SchemaEntry) => (key === "__note" ? e.path : entryValue(e, key));
		const dir = this.sortDesc ? -1 : 1;
		return [...entries].sort((a, b) => {
			const va = value(a);
			const vb = value(b);
			if (!va !== !vb) return va ? -1 : 1; // empty values last either way
			const na = Number(va);
			const nb = Number(vb);
			const cmp = va && vb && !isNaN(na) && !isNaN(nb) ? na - nb : va.localeCompare(vb, undefined, { numeric: true });
			return cmp * dir || a.name.localeCompare(b.name);
		});
	}

	private renderTable(): void {
		if (!this.bodyEl) return;
		if (this.editing) {
			this.pendingRender = true;
			return;
		}
		this.pendingRender = false;
		this.bodyEl.empty();
		const all = this.plugin.index.entries(this.tag);
		const shown = this.filter.trim() ? rankEntries(all, this.filter, all.length).map((m) => m.entry) : all;
		this.countEl.setText(shown.length === all.length ? `${all.length} entries` : `${shown.length} of ${all.length}`);

		if (!this.tag) {
			this.empty("No schemas yet", "Add one in Settings → Inline Schema Expander.");
			return;
		}
		if (all.length === 0) {
			this.empty(`No ${this.tag} entries yet`, `Type ${this.tag} followed by a space in any note, or tag a note ${this.tag}.`);
			return;
		}
		if (shown.length === 0) {
			this.empty("Nothing matches", "Try fewer words.");
			return;
		}

		const cols = this.columns(all);
		const table = this.bodyEl.createEl("table", { cls: "ise-table" });
		const headRow = table.createEl("thead").createEl("tr");
		for (const c of cols) {
			const th = headRow.createEl("th", { attr: { scope: "col" } });
			const btn = th.createEl("button", { cls: "ise-th-button", text: c.label });
			if (this.sortKey.toLowerCase() === c.key.toLowerCase()) {
				th.setAttr("aria-sort", this.sortDesc ? "descending" : "ascending");
				setIcon(btn.createSpan({ cls: "ise-sort-icon" }), this.sortDesc ? "chevron-down" : "chevron-up");
			}
			btn.addEventListener("click", () => {
				if (this.sortKey.toLowerCase() === c.key.toLowerCase()) this.sortDesc = !this.sortDesc;
				else {
					this.sortKey = c.key;
					this.sortDesc = false;
				}
				this.renderTable();
				this.app.workspace.requestSaveLayout();
			});
		}
		const body = table.createEl("tbody");
		for (const entry of this.sorted(shown)) {
			const tr = body.createEl("tr");
			for (const c of cols) {
				const td = tr.createEl("td");
				if (c.key === "name") {
					const a = td.createEl("a", { cls: "ise-entry-link", text: entry.name, attr: { href: "#" } });
					a.addEventListener("click", (evt) => {
						evt.preventDefault();
						void this.plugin.openEntry(entry, Keymap.isModEvent(evt));
					});
				} else if (c.key === "__note") {
					td.addClass("ise-note-cell");
					const base = entry.path.split("/").pop()?.replace(/\.md$/i, "") ?? entry.path;
					const a = td.createEl("a", { cls: "ise-note-link", text: base, attr: { href: "#", "aria-label": entry.path } });
					a.addEventListener("click", (evt) => {
						evt.preventDefault();
						void this.plugin.openEntry(entry, Keymap.isModEvent(evt));
					});
				} else {
					this.renderCell(td, entry, c);
				}
			}
		}
	}

	private renderCell(td: HTMLElement, entry: SchemaEntry, col: Column): void {
		td.empty();
		const value = entryValue(entry, col.key);
		td.addClass("ise-cell");
		td.toggleClass("is-empty", !value);
		const span = td.createDiv({ cls: "ise-cell-value", text: value || "—" });
		if (value) span.setAttr("title", value);
		td.setAttr("tabindex", "0");
		td.setAttr("aria-label", `Edit ${col.label}`);
		const edit = () => this.editCell(td, entry, col, value);
		td.onclick = edit;
		td.onkeydown = (evt) => {
			if (evt.key === "Enter") {
				evt.preventDefault();
				edit();
			}
		};
	}

	private editCell(td: HTMLElement, entry: SchemaEntry, col: Column, value: string): void {
		if (td.querySelector("input")) return;
		this.editing = true;
		td.empty();
		td.onclick = null;
		td.addClass("is-editing");
		const input = td.createEl("input", { type: "text", cls: "ise-cell-input", value });
		input.focus();
		input.select();
		let done = false;
		const finish = async (save: boolean) => {
			if (done) return;
			done = true;
			td.removeClass("is-editing");
			const next = input.value.trim();
			if (save && next !== value) {
				await this.plugin.setEntryField(entry, col.key, next);
				this.editing = false;
				// Shows the saved value now; the index update re-renders again once Obsidian re-reads the note.
				this.renderTable();
				return;
			}
			this.editing = false;
			if (this.pendingRender) this.renderTable();
			else this.renderCell(td, entry, col);
		};
		input.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter") {
				evt.preventDefault();
				void finish(true);
			} else if (evt.key === "Escape") {
				evt.preventDefault();
				evt.stopPropagation();
				void finish(false);
			}
		});
		input.addEventListener("blur", () => void finish(true));
	}

	private empty(title: string, desc: string): void {
		const el = this.bodyEl.createDiv({ cls: "ise-table-empty" });
		el.createDiv({ cls: "ise-table-empty-title", text: title });
		el.createDiv({ cls: "ise-table-empty-desc", text: desc });
	}
}
