import {
	App,
	ExtraButtonComponent,
	Plugin,
	PluginSettingTab,
	Setting,
	SettingDefinitionItem,
	SettingGroupItem,
	debounce,
	requireApiVersion,
} from "obsidian";
import {
	computeOffsetFromFirstBracket,
	createSchemaExpanderExtension,
	DEFAULT_SCHEMAS,
	loadSchemas,
	SchemaRule,
} from "./schemaExpander";

export interface InlineSchemaExpanderSettings {
	schemas: SchemaRule[];
}

/** Fresh default settings: schemas are copied so editing settings never changes the defaults. */
export function defaultSettings(): InlineSchemaExpanderSettings {
	return { schemas: DEFAULT_SCHEMAS.map((s) => ({ ...s })) };
}

export default class InlineSchemaExpanderPlugin extends Plugin {
	settings: InlineSchemaExpanderSettings = defaultSettings();

	/** Save once typing in a settings field pauses, not on every keystroke. */
	requestSave = debounce(() => void this.saveSettings(), 500, true);

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerEditorExtension(
			createSchemaExpanderExtension(() => this.settings.schemas)
		);

		this.addSettingTab(new InlineSchemaSettingTab(this.app, this));
	}

	onunload(): void {
		// Write any edit still waiting on the debounce
		this.requestSave.run();
	}

	async loadSettings(): Promise<void> {
		const schemas = loadSchemas(await this.loadData());
		this.settings = schemas ? { schemas } : defaultSettings();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
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

	/**
	 * Declarative settings (Obsidian 1.13+): rendered by Obsidian and indexed for settings search.
	 * `display()` renders the same definitions on older versions.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		const items: SettingDefinitionItem[] = [
			{
				type: "group",
				heading: "Schemas",
				items: [
					{
						name: "Add new schema",
						desc: "Tags that expand into inline field templates when followed by a space or tab. Add a trigger tag and its expansion template.",
						aliases: ["trigger tag", "template", "inline fields"],
						render: (setting) => {
							setting.addButton((btn) =>
								btn
									.setButtonText("Add schema")
									.setCta()
									.onClick(async () => {
										const defaultExpansion = "#new-tag [field1:: ] [field2:: ]";
										this.plugin.settings.schemas.push({
											triggerTag: "#new-tag",
											expansionText: defaultExpansion,
											cursorOffset: computeOffsetFromFirstBracket(defaultExpansion),
										});
										await this.plugin.saveSettings();
										this.refresh();
									})
							);
						},
					},
				],
			},
		];

		this.plugin.settings.schemas.forEach((schema, index) => {
			items.push({
				type: "group",
				heading: `Schema ${index + 1}`,
				extraButtons: [
					(btn: ExtraButtonComponent) =>
						btn
							.setIcon("reset")
							.setTooltip("Set the cursor offset from the first empty field")
							.onClick(async () => {
								schema.cursorOffset = computeOffsetFromFirstBracket(schema.expansionText);
								await this.plugin.saveSettings();
								this.refresh();
							}),
					(btn: ExtraButtonComponent) =>
						btn
							.setIcon("trash")
							.setTooltip("Delete schema")
							.onClick(async () => {
								this.plugin.settings.schemas.splice(index, 1);
								await this.plugin.saveSettings();
								this.refresh();
							}),
				],
				items: this.schemaItems(schema),
			});
		});

		return items;
	}

	private schemaItems(schema: SchemaRule): SettingGroupItem[] {
		return [
			{
				name: "Trigger tag",
				desc: "Tag that triggers the expansion when followed by a space or tab, e.g. #case-law.",
				aliases: [schema.triggerTag],
				render: (setting) => {
					setting.addText((text) =>
						text
							.setPlaceholder("#case-law")
							.setValue(schema.triggerTag)
							.onChange((value) => {
								schema.triggerTag = value.trim();
								this.plugin.requestSave();
							})
					);
				},
			},
			{
				// The template is usually longer than a text field: give it the full row width.
				name: "Expansion text",
				desc: "Full inline schema to insert, e.g. #case-law [court:: ] [year:: ] [ratio:: ].",
				render: (setting) => {
					setting.setClass("inline-schema-expansion").addTextArea((text) => {
						text
							.setPlaceholder("#case-law [court:: ] [year:: ] [ratio:: ]")
							.setValue(schema.expansionText)
							.onChange((value) => {
								schema.expansionText = value;
								this.plugin.requestSave();
							});
						text.inputEl.rows = 2;
						text.inputEl.spellcheck = false;
					});
				},
			},
			{
				name: "Cursor offset",
				desc: "Characters back from the end of the expansion text to place the cursor (0 = the first empty field).",
				render: (setting) => {
					setting.addText((text) => {
						text
							.setPlaceholder("22")
							.setValue(String(schema.cursorOffset))
							.onChange((value) => {
								const parsed = parseInt(value, 10);
								schema.cursorOffset = Number.isNaN(parsed) ? 0 : Math.max(0, parsed);
								this.plugin.requestSave();
							});
						text.inputEl.type = "number";
						text.inputEl.min = "0";
						text.inputEl.addClass("inline-schema-offset");
					});
				},
			},
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
