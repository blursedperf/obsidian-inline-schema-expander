import {
	App,
	Editor,
	editorInfoField,
	ExtraButtonComponent,
	MarkdownView,
	Menu,
	Modal,
	normalizePath,
	Notice,
	PaneType,
	Plugin,
	PluginSettingTab,
	Setting,
	SettingDefinitionItem,
	SettingGroupItem,
	SuggestModal,
	TFile,
	TFolder,
	debounce,
	requireApiVersion,
} from "obsidian";
import { createFieldHighlighter } from "./decorations";
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
} from "./edits";
import { EntryIndex } from "./entryIndex";
import { findTag, normalizeTag } from "./fields";
import { EntryFinderModal } from "./finder";
import { parseEntries, SchemaEntry } from "./instances";
import { blankSchema, copySchema, DEFAULT_SCHEMAS, loadSchemas, parseList, SchemaRule, STARTERS } from "./schema";
import { createSchemaExpanderExtension } from "./schemaExpander";
import { SchemaTableView, TABLE_VIEW } from "./tableView";
import { nowContext, templateFields } from "./template";
import { FieldValueSuggest } from "./valueSuggest";

export interface InlineSchemaExpanderSettings {
	schemas: SchemaRule[];
	/** Tab and Shift+Tab move between a schema line's fields. */
	tabNavigation: boolean;
	/** Mark empty and missing required fields in the editor. */
	highlightFields: boolean;
	/** Suggest a field's choices and earlier values while typing in it. */
	suggestValues: boolean;
}

/** Fresh default settings: schemas are copied so editing settings never changes the defaults. */
export function defaultSettings(): InlineSchemaExpanderSettings {
	return { schemas: DEFAULT_SCHEMAS.map(copySchema), tabNavigation: true, highlightFields: true, suggestValues: true };
}

export default class InlineSchemaExpanderPlugin extends Plugin {
	settings: InlineSchemaExpanderSettings = defaultSettings();
	index!: EntryIndex;
	/** Save once typing in a settings field pauses, not on every keystroke. */
	requestSave = debounce(() => void this.saveSettings(), 500, true);
	/** Re-read the vault once a trigger tag stops changing in settings. */
	private requestReindex = debounce(() => void this.index.rebuild(), 800, true);

	async onload(): Promise<void> {
		await this.loadSettings();
		this.index = new EntryIndex(this.app, () => this.settings.schemas);

		this.registerEditorExtension([
			createSchemaExpanderExtension({
				getSchemas: () => this.settings.schemas,
				getContext: (state) => nowContext(state.field(editorInfoField, false)?.file?.basename ?? ""),
				tabNavigation: () => this.settings.tabNavigation,
			}),
			createFieldHighlighter(() => this.settings.schemas, () => this.settings.highlightFields),
		]);
		this.registerEditorSuggest(new FieldValueSuggest(this));
		this.registerView(TABLE_VIEW, (leaf) => new SchemaTableView(leaf, this));
		this.addSettingTab(new InlineSchemaSettingTab(this.app, this));
		this.addRibbonIcon("table", "Open schema table", () => void this.openTable());

		this.addCommand({
			id: "find-entry",
			name: "Find entry",
			callback: () => this.openFinder("open"),
		});
		this.addCommand({
			id: "insert-citation",
			name: "Insert citation",
			editorCallback: () => this.openFinder("cite"),
		});
		this.addCommand({
			id: "open-table",
			name: "Open schema table",
			callback: () => void this.openTable(),
		});
		this.addCommand({
			id: "promote-line",
			name: "Promote line to note",
			editorCheckCallback: (checking, editor, ctx) => {
				const entry = ctx.file ? this.entryAtCursor(editor, ctx.file) : null;
				if (!entry || !ctx.file) return false;
				if (!checking) void this.promote(editor, ctx.file, entry);
				return true;
			},
		});
		this.addCommand({
			id: "add-missing-fields",
			name: "Add missing fields to existing lines",
			callback: () => this.chooseSchema((schema) => void this.addMissingFieldsEverywhere(schema)),
		});

		this.registerEvent(this.app.metadataCache.on("changed", (file, data) => void this.index.onChanged(file, data)));
		this.registerEvent(this.app.vault.on("delete", (file) => this.index.onDeleted(file)));
		this.registerEvent(this.app.vault.on("rename", (file, old) => this.index.onRenamed(file, old)));
		this.app.workspace.onLayoutReady(() => void this.index.rebuild());
	}

	onunload(): void {
		// Write any edit still waiting on the debounce
		this.requestSave.run();
	}

	async loadSettings(): Promise<void> {
		const raw = (await this.loadData()) as Partial<InlineSchemaExpanderSettings> | null;
		const schemas = loadSchemas(raw);
		const defaults = defaultSettings();
		this.settings = {
			schemas: schemas ?? defaults.schemas,
			tabNavigation: typeof raw?.tabNavigation === "boolean" ? raw.tabNavigation : defaults.tabNavigation,
			highlightFields: typeof raw?.highlightFields === "boolean" ? raw.highlightFields : defaults.highlightFields,
			suggestValues: typeof raw?.suggestValues === "boolean" ? raw.suggestValues : defaults.suggestValues,
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** After a schema's tag or fields change: re-read the vault and refresh open tables. */
	schemasChanged(): void {
		this.requestSave();
		this.requestReindex();
		for (const leaf of this.app.workspace.getLeavesOfType(TABLE_VIEW)) {
			if (leaf.view instanceof SchemaTableView) leaf.view.refresh();
		}
	}

	schemaFor(tag: string): SchemaRule | undefined {
		const t = normalizeTag(tag);
		return this.settings.schemas.find((s) => normalizeTag(s.triggerTag) === t);
	}

	// ── Finding and opening entries ──────────────────────────────────────────

	private openFinder(mode: "open" | "cite"): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		new EntryFinderModal(this.app, this, mode, view?.editor ?? null, view?.file?.path ?? "").open();
	}

	async openTable(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(TABLE_VIEW)[0];
		const leaf = existing ?? this.app.workspace.getLeaf("tab");
		if (!existing) await leaf.setViewState({ type: TABLE_VIEW, active: true });
		// setActiveLeaf rather than revealLeaf, which only returns a Promise from Obsidian 1.7.2.
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
	}

	async openEntry(entry: SchemaEntry, newTab: PaneType | boolean): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(entry.path);
		if (!(file instanceof TFile)) return;
		const leaf = this.app.workspace.getLeaf(newTab);
		await leaf.openFile(file, entry.line !== null ? { eState: { line: entry.line } } : {});
	}

	citationFor(entry: SchemaEntry): string {
		const schema = this.schemaFor(entry.tag);
		return formatCitation(schema?.citationFormat || "{{name}}", entry);
	}

	/** A link to the entry's note, to its block when the line has a `^block-id`. */
	linkFor(entry: SchemaEntry, sourcePath: string): string {
		const file = this.app.vault.getAbstractFileByPath(entry.path);
		if (!(file instanceof TFile)) return entry.name;
		const subpath = entry.blockId ? `#^${entry.blockId}` : undefined;
		const alias = entry.name !== file.basename ? entry.name : undefined;
		return this.app.fileManager.generateMarkdownLink(file, sourcePath, subpath, alias);
	}

	// ── Editing entries ──────────────────────────────────────────────────────

	/** Writes a field value back to the note the entry lives in. */
	async setEntryField(entry: SchemaEntry, key: string, value: string): Promise<boolean> {
		const file = this.app.vault.getAbstractFileByPath(entry.path);
		if (!(file instanceof TFile)) return false;
		try {
			if (entry.line !== null) {
				await this.app.vault.process(file, (text) => {
					const lines = text.split("\n");
					const cr = (s: string) => (s.endsWith("\r") ? s.slice(0, -1) : s);
					let i = entry.line ?? -1;
					if (cr(lines[i] ?? "") !== entry.lineText) i = lines.findIndex((l) => cr(l) === entry.lineText);
					if (i < 0) throw new Error("line changed");
					const ending = lines[i].endsWith("\r") ? "\r" : "";
					lines[i] = setFieldInLine(cr(lines[i]), entry.tag, key, value) + ending;
					entry.lineText = cr(lines[i]);
					entry.line = i;
					return lines.join("\n");
				});
			} else {
				await this.setNoteField(file, key, value);
			}
		} catch {
			new Notice(`Couldn't update ${entry.name}: the note changed. Try again.`);
			return false;
		}
		const f = entry.fields.find((x) => x.keyLower === key.toLowerCase());
		if (f) f.value = value;
		else entry.fields.push({ key, keyLower: key.toLowerCase(), value });
		return true;
	}

	/** A whole-note entry: update the property, or the `Key:: value` line, or add a property. */
	private async setNoteField(file: TFile, key: string, value: string): Promise<void> {
		const k = key.toLowerCase();
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
		const propKey = Object.keys(fm).find((x) => x.toLowerCase() === k);
		if (!propKey) {
			const keyRe = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			const lineRe = new RegExp(`^\\s*(?:[-*+]\\s+)?(?:\\*\\*|__)?${keyRe}(?:\\*\\*|__)?::.*$`, "im");
			if (lineRe.test(await this.app.vault.read(file))) {
				await this.app.vault.process(file, (t) => t.replace(lineRe, (line) => setFullLineField(line, value)));
				return;
			}
		}
		await this.app.fileManager.processFrontMatter(file, (front: Record<string, unknown>) => {
			front[propKey ?? key] = /^\d+(\.\d+)?$/.test(value) ? Number(value) : value;
		});
	}

	private entryAtCursor(editor: Editor, file: TFile): SchemaEntry | null {
		const line = editor.getCursor().line;
		const lineText = editor.getLine(line);
		if (!this.settings.schemas.some((s) => findTag(lineText, s.triggerTag) !== -1)) return null;
		const entries = parseEntries(editor.getValue(), file.path, file.basename, this.settings.schemas, null);
		return entries.find((e) => e.line === line) ?? null;
	}

	// ── Promoting a line to a note ───────────────────────────────────────────

	private async promote(editor: Editor, source: TFile, entry: SchemaEntry): Promise<void> {
		const schema = this.schemaFor(entry.tag);
		if (!schema || entry.line === null) return;
		const name = noteFileName(entry.name);
		if (!name || name === source.basename) {
			new Notice("Write the entry's name before its tag first, e.g. Donoghue v Stevenson #case-law.");
			return;
		}
		const folder = normalizePath(schema.noteFolder.trim() || source.parent?.path || "/");
		const path = normalizePath(folder === "/" ? `${name}.md` : `${folder}/${name}.md`);
		let file = this.app.vault.getAbstractFileByPath(path);
		const existed = file instanceof TFile;
		if (!existed) {
			if (folder !== "/" && !(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) {
				await this.app.vault.createFolder(folder);
			}
			let template: string | null = null;
			if (schema.noteTemplate.trim()) {
				const tPath = normalizePath(schema.noteTemplate.trim().replace(/\.md$/i, "") + ".md");
				const tFile = this.app.vault.getAbstractFileByPath(tPath);
				if (tFile instanceof TFile) template = await this.app.vault.read(tFile);
				else new Notice(`Note template ${tPath} not found; using the section headings instead.`);
			}
			const ctx = nowContext(name);
			const created = await this.app.vault.create(path, promotedBody(schema, entry, template, ctx));
			file = created;
			const props = promotedProperties(schema, entry);
			const tagName = normalizeTag(schema.triggerTag).slice(1);
			await this.app.fileManager.processFrontMatter(created, (front: Record<string, unknown>) => {
				const tags = Array.isArray(front.tags) ? (front.tags as unknown[]) : typeof front.tags === "string" ? [front.tags] : [];
				if (!tags.some((t) => typeof t === "string" && normalizeTag(t) === normalizeTag(tagName))) tags.push(tagName);
				front.tags = tags;
				for (const [k, v] of Object.entries(props)) {
					if (front[k] === undefined || front[k] === null || front[k] === "") front[k] = v === "" ? null : v;
				}
			});
		}
		if (!(file instanceof TFile)) return;
		const link = this.app.fileManager.generateMarkdownLink(file, source.path);
		// The line may have moved while the note was created; find it again by its text.
		let line = entry.line;
		if (editor.getLine(line) !== entry.lineText) {
			const lines = editor.getValue().split("\n");
			line = lines.indexOf(entry.lineText);
		}
		if (line >= 0) {
			editor.setLine(line, promotedLine(entry.lineText, link));
		}
		new Notice(existed ? `${name} already exists: linked to it.` : `Created ${name}.`);
		await this.app.workspace.getLeaf("tab").openFile(file);
	}

	// ── Adding new fields to existing lines ──────────────────────────────────

	chooseSchema(run: (schema: SchemaRule) => void): void {
		const schemas = this.settings.schemas.filter((s) => s.triggerTag.trim());
		if (schemas.length === 1) run(schemas[0]);
		else if (schemas.length > 1) new SchemaPickerModal(this.app, schemas, run).open();
		else new Notice("No schemas yet: add one in settings.");
	}

	async addMissingFieldsEverywhere(schema: SchemaRule): Promise<void> {
		await this.index.whenReady();
		const keys = templateFields(schema.expansionText).map((f) => f.key);
		const lines = this.index.entries(schema.triggerTag).filter((e) => e.line !== null);
		const affected = lines.filter((e) => addMissingFields(e.lineText, e.tag, keys) !== null);
		if (affected.length === 0) {
			new Notice(`All ${lines.length} ${schema.triggerTag} lines already have every field.`);
			return;
		}
		const paths = [...new Set(affected.map((e) => e.path))];
		const missing = keys.filter((k) => affected.some((e) => !e.fields.some((f) => f.keyLower === k.toLowerCase())));
		new ConfirmModal(
			this.app,
			"Add missing fields",
			`Add ${missing.map((k) => `[${k}:: ]`).join(" ")} to ${affected.length} ${schema.triggerTag} line${affected.length === 1 ? "" : "s"} in ${paths.length} note${paths.length === 1 ? "" : "s"}? Only fields a line lacks are added; values stay as they are.`,
			"Add fields",
			async () => {
				let changed = 0;
				for (const p of paths) {
					const file = this.app.vault.getAbstractFileByPath(p);
					if (!(file instanceof TFile)) continue;
					await this.app.vault.process(file, (text) => {
						const r = addMissingFieldsInText(text, schema);
						changed += r.changed;
						return r.text;
					});
				}
				new Notice(`Added fields to ${changed} line${changed === 1 ? "" : "s"}.`);
			}
		).open();
	}
}

class ConfirmModal extends Modal {
	constructor(app: App, title: string, private readonly message: string, private readonly cta: string, private readonly onConfirm: () => Promise<void>) {
		super(app);
		this.titleEl.setText(title);
	}

	onOpen(): void {
		this.contentEl.createEl("p", { text: this.message });
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(this.cta)
					.setCta()
					.onClick(async () => {
						b.setDisabled(true);
						await this.onConfirm();
						this.close();
					})
			);
	}
}

class SchemaPickerModal extends SuggestModal<SchemaRule> {
	constructor(app: App, private readonly schemas: SchemaRule[], private readonly run: (s: SchemaRule) => void) {
		super(app);
		this.setPlaceholder("Choose a schema…");
	}

	getSuggestions(query: string): SchemaRule[] {
		const q = query.toLowerCase();
		return this.schemas.filter((s) => s.triggerTag.toLowerCase().includes(q));
	}

	renderSuggestion(s: SchemaRule, el: HTMLElement): void {
		el.createDiv({ text: s.triggerTag });
		el.createEl("small", { cls: "ise-picker-fields", text: templateFields(s.expansionText).map((f) => f.key).join(", ") });
	}

	onChooseSuggestion(s: SchemaRule): void {
		this.run(s);
	}
}

export class InlineSchemaSettingTab extends PluginSettingTab {
	private plugin: InlineSchemaExpanderPlugin;

	constructor(app: App, plugin: InlineSchemaExpanderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/** Rebuilds the tab after a schema is added or removed, on both the 1.13+ and legacy paths. */
	private refresh(): void {
		if (requireApiVersion("1.13.0")) {
			this.update();
		} else {
			this.display();
		}
	}

	private toggle(name: string, desc: string, get: () => boolean, set: (v: boolean) => void): SettingGroupItem {
		return {
			name,
			desc,
			render: (setting) => {
				setting.addToggle((t) =>
					t.setValue(get()).onChange(async (v) => {
						set(v);
						await this.plugin.saveSettings();
					})
				);
			},
		};
	}

	/**
	 * Declarative settings (Obsidian 1.13+): rendered by Obsidian and indexed for settings search.
	 * `display()` renders the same definitions on older versions.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		const s = this.plugin.settings;
		const items: SettingDefinitionItem[] = [
			{
				type: "group",
				heading: "Editing",
				items: [
					this.toggle(
						"Tab moves between fields",
						"On a schema line, Tab jumps to the next empty field and Shift+Tab to the previous field. Once every field is filled, Tab indents as usual.",
						() => s.tabNavigation,
						(v) => (s.tabNavigation = v)
					),
					this.toggle(
						"Highlight empty fields",
						"Mark empty fields, flag required ones, and show a button for a required field a line is missing.",
						() => s.highlightFields,
						(v) => (s.highlightFields = v)
					),
					this.toggle(
						"Suggest values",
						"While typing in a field, suggest its choices and the values used for it before (short fields such as court or year).",
						() => s.suggestValues,
						(v) => (s.suggestValues = v)
					),
				],
			},
			{
				type: "group",
				heading: "Schemas",
				items: [
					{
						name: "Add schema",
						desc: "Start from a case, statute, principle or exam issue, or from a blank schema.",
						aliases: ["trigger tag", "template", "inline fields", "starter"],
						render: (setting) => {
							setting.addButton((btn) =>
								btn
									.setButtonText("Add schema")
									.setCta()
									.onClick((evt) => {
										const menu = new Menu();
										const taken = new Set(s.schemas.map((x) => normalizeTag(x.triggerTag)));
										for (const st of STARTERS) {
											menu.addItem((item) =>
												item
													.setTitle(`${st.label} (${st.schema.triggerTag})`)
													.setDisabled(taken.has(normalizeTag(st.schema.triggerTag)))
													.onClick(() => this.addSchema(copySchema(st.schema)))
											);
										}
										menu.addSeparator();
										menu.addItem((item) => item.setTitle("Blank schema").onClick(() => this.addSchema(blankSchema())));
										menu.showAtMouseEvent(evt);
									})
							);
						},
					},
				],
			},
		];

		s.schemas.forEach((schema, index) => {
			items.push({
				type: "group",
				heading: schema.triggerTag.trim() || `Schema ${index + 1}`,
				extraButtons: [
					(btn: ExtraButtonComponent) =>
						btn
							.setIcon("list-plus")
							.setTooltip("Add this schema's fields to existing lines that lack them")
							.onClick(() => void this.plugin.addMissingFieldsEverywhere(schema)),
					(btn: ExtraButtonComponent) =>
						btn
							.setIcon("trash")
							.setTooltip("Delete schema")
							.onClick(async () => {
								s.schemas.splice(index, 1);
								await this.plugin.saveSettings();
								this.plugin.schemasChanged();
								this.refresh();
							}),
				],
				items: this.schemaItems(schema),
			});
		});
		return items;
	}

	private async addSchema(schema: SchemaRule): Promise<void> {
		this.plugin.settings.schemas.push(schema);
		await this.plugin.saveSettings();
		this.plugin.schemasChanged();
		this.refresh();
	}

	private text(
		name: string,
		desc: string,
		placeholder: string,
		get: () => string,
		set: (v: string) => void,
		opts: { wide?: boolean; reindex?: boolean; aliases?: string[] } = {}
	): SettingGroupItem {
		return {
			name,
			desc,
			aliases: opts.aliases,
			render: (setting) => {
				if (opts.wide) setting.setClass("inline-schema-expansion");
				setting.addText((text) => {
					text
						.setPlaceholder(placeholder)
						.setValue(get())
						.onChange((value) => {
							set(value);
							if (opts.reindex) this.plugin.schemasChanged();
							else this.plugin.requestSave();
						});
					text.inputEl.spellcheck = false;
				});
			},
		};
	}

	private schemaItems(schema: SchemaRule): SettingGroupItem[] {
		return [
			this.text(
				"Trigger tag",
				"Expands when followed by a space or Tab, or when picked from tag suggestions.",
				"#case-law",
				() => schema.triggerTag,
				(v) => (schema.triggerTag = v.trim()),
				{ reindex: true, aliases: [schema.triggerTag] }
			),
			{
				// The template is usually longer than a text field: give it the full row width.
				name: "Template",
				desc: "What the tag expands into. ${UKSC|HL|CA} offers choices, ${text} fills in a default, and {{date}}, {{time}} and {{title}} are filled in. The cursor starts in the first field.",
				aliases: ["expansion text", "placeholders", "choices"],
				render: (setting) => {
					setting.setClass("inline-schema-expansion").addTextArea((text) => {
						text
							.setPlaceholder("#case-law [court:: ${UKSC|HL|CA}] [year:: ] [ratio:: ]")
							.setValue(schema.expansionText)
							.onChange((value) => {
								schema.expansionText = value;
								this.plugin.schemasChanged();
							});
						text.inputEl.rows = 2;
						text.inputEl.spellcheck = false;
					});
				},
			},
			this.text(
				"Required fields",
				"Comma-separated. Flagged in the editor while empty or missing.",
				"ratio",
				() => schema.requiredFields.join(", "),
				(v) => (schema.requiredFields = parseList(v))
			),
			this.text(
				"Citation format",
				"Used by Insert citation. {{name}} is the text before the tag; any field works, e.g. {{year}}. Empty brackets are dropped.",
				"*{{name}}* [{{year}}] {{citation}} ({{court}})",
				() => schema.citationFormat,
				(v) => (schema.citationFormat = v),
				{ wide: true, aliases: ["oscola", "reference"] }
			),
			this.text(
				"Note folder",
				"Where Promote line to note creates notes. Empty: beside the current note.",
				"Cases",
				() => schema.noteFolder,
				(v) => (schema.noteFolder = v.trim())
			),
			this.text(
				"Note sections",
				"Comma-separated headings a promoted note starts with.",
				"Facts, Issue, Held, Ratio",
				() => schema.noteSections.join(", "),
				(v) => (schema.noteSections = parseList(v))
			),
			this.text(
				"Note template",
				"Optional note to copy instead of the headings. {{name}}, {{date}} and any {{field}} are filled in.",
				"Templates/Case",
				() => schema.noteTemplate,
				(v) => (schema.noteTemplate = v.trim())
			),
		];
	}

	// ── Legacy fallback (Obsidian < 1.13) ────────────────────────────────────
	// Obsidian 1.13+ renders getSettingDefinitions() itself and never calls this.
	// Older versions call display(), so render the same definitions imperatively,
	// with the same group structure Obsidian uses.
	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		for (const item of this.getSettingDefinitions()) {
			if (!("type" in item) || (item.type !== "group" && item.type !== "list")) continue;
			const groupEl = containerEl.createDiv({ cls: "setting-group" });
			const heading = new Setting(groupEl).setName(item.heading ?? "").setHeading();
			for (const configure of item.extraButtons ?? []) heading.addExtraButton(configure);
			const itemsEl = groupEl.createDiv({ cls: "setting-items" });
			for (const def of item.items ?? []) {
				if ("type" in def) continue;
				const setting = new Setting(itemsEl).setName(def.name);
				if (def.desc) setting.setDesc(def.desc);
				if ("render" in def && def.render) def.render(setting, undefined as never);
			}
		}
	}
}
