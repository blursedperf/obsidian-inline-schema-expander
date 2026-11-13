import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	debounce,
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

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Schemas")
			.setDesc(
				"Tags that expand into inline field templates when followed by a space or tab. Set the cursor offset to 0 to place the cursor in the first empty field, e.g. [field:: ]."
			)
			.setHeading();

		new Setting(containerEl)
			.setName("Add new schema")
			.setDesc("Add a new trigger tag and inline expansion template.")
			.addButton((btn) =>
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
						this.display();
					})
			);

		this.plugin.settings.schemas.forEach((schema, index) => {
			const groupEl = containerEl.createDiv({
				cls: "inline-schema-setting-group",
			});

			new Setting(groupEl)
				.setName(`Schema #${index + 1}`)
				.addExtraButton((btn) =>
					btn
						.setIcon("reset")
						.setTooltip("Set the cursor offset from the first empty field")
						.onClick(async () => {
							schema.cursorOffset = computeOffsetFromFirstBracket(
								schema.expansionText
							);
							await this.plugin.saveSettings();
							this.display();
						})
				)
				.addExtraButton((btn) =>
					btn
						.setIcon("trash")
						.setTooltip("Delete schema")
						.onClick(async () => {
							this.plugin.settings.schemas.splice(index, 1);
							await this.plugin.saveSettings();
							this.display();
						})
				);

			new Setting(groupEl)
				.setName("Trigger tag")
				.setDesc("Tag that triggers the expansion when followed by a space or tab, e.g. #case-law.")
				.addText((text) =>
					text
						.setPlaceholder("#case-law")
						.setValue(schema.triggerTag)
						.onChange((value) => {
							schema.triggerTag = value.trim();
							this.plugin.requestSave();
						})
				);

			new Setting(groupEl)
				.setName("Expansion text")
				.setDesc("Full inline schema to insert, e.g. #case-law [court:: ] [year:: ] [ratio:: ].")
				.addText((text) =>
					text
						.setPlaceholder("#case-law [court:: ] [year:: ] [ratio:: ]")
						.setValue(schema.expansionText)
						.onChange((value) => {
							schema.expansionText = value;
							this.plugin.requestSave();
						})
				);

			new Setting(groupEl)
				.setName("Cursor offset")
				.setDesc(
					"Characters back from the end of the expansion text to place the cursor (0 = the first empty field)."
				)
				.addText((text) =>
					text
						.setPlaceholder("22")
						.setValue(String(schema.cursorOffset))
						.onChange((value) => {
							const parsed = parseInt(value, 10);
							schema.cursorOffset = Number.isNaN(parsed) ? 0 : Math.max(0, parsed);
							this.plugin.requestSave();
						})
				);
		});
	}
}
