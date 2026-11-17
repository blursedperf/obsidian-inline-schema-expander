/** Keeps every schema entry in the vault, updated as notes change. Read-only: it never edits notes. */
import { App, Events, TAbstractFile, TFile } from "obsidian";
import { normalizeTag } from "./fields";
import { parseEntries, SchemaEntry } from "./instances";
import type { SchemaRule } from "./schema";

export class EntryIndex extends Events {
	private byPath = new Map<string, SchemaEntry[]>();
	private building: Promise<void> | null = null;
	private generation = 0;

	constructor(private readonly app: App, private readonly getSchemas: () => SchemaRule[]) {
		super();
	}

	/** Re-reads every Markdown note; a newer rebuild supersedes one in progress. */
	rebuild(): Promise<void> {
		const gen = ++this.generation;
		this.building = (async () => {
			const next = new Map<string, SchemaEntry[]>();
			const files = this.app.vault.getMarkdownFiles();
			for (let i = 0; i < files.length; i++) {
				if (gen !== this.generation) return;
				const entries = await this.read(files[i]);
				if (entries.length > 0) next.set(files[i].path, entries);
				if (i % 200 === 199) await new Promise((r) => window.setTimeout(r, 0));
			}
			if (gen !== this.generation) return;
			this.byPath = next;
			this.trigger("updated");
		})();
		return this.building;
	}

	whenReady(): Promise<void> {
		return this.building ?? Promise.resolve();
	}

	private async read(file: TFile, data?: string): Promise<SchemaEntry[]> {
		const text = data ?? (await this.app.vault.cachedRead(file));
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		return parseEntries(text, file.path, file.basename, this.getSchemas(), fm ?? null);
	}

	async onChanged(file: TFile, data: string): Promise<void> {
		const entries = await this.read(file, data);
		const had = this.byPath.has(file.path);
		if (entries.length > 0) this.byPath.set(file.path, entries);
		else this.byPath.delete(file.path);
		if (had || entries.length > 0) this.trigger("updated");
	}

	onDeleted(file: TAbstractFile): void {
		if (this.byPath.delete(file.path)) this.trigger("updated");
	}

	onRenamed(file: TAbstractFile, oldPath: string): void {
		const entries = this.byPath.get(oldPath);
		if (!entries) return;
		this.byPath.delete(oldPath);
		const basename = file instanceof TFile ? file.basename : "";
		this.byPath.set(
			file.path,
			entries.map((e) => ({ ...e, path: file.path, name: e.line === null && e.name === oldPath.split("/").pop()?.replace(/\.md$/, "") ? basename : e.name }))
		);
		this.trigger("updated");
	}

	/** Every entry, or those of one tag, sorted by name. */
	entries(tag?: string): SchemaEntry[] {
		const t = tag ? normalizeTag(tag) : null;
		const out: SchemaEntry[] = [];
		for (const list of this.byPath.values()) for (const e of list) if (!t || e.tag === t) out.push(e);
		return out.sort((a, b) => a.name.localeCompare(b.name));
	}

	/** Values used for a field of a tag, most used first. */
	values(tag: string, key: string): { value: string; count: number }[] {
		const t = normalizeTag(tag);
		const k = key.toLowerCase();
		const counts = new Map<string, { value: string; count: number }>();
		for (const list of this.byPath.values()) {
			for (const e of list) {
				if (e.tag !== t) continue;
				for (const f of e.fields) {
					if (f.keyLower !== k || !f.value) continue;
					const id = f.value.toLowerCase();
					const c = counts.get(id);
					if (c) c.count++;
					else counts.set(id, { value: f.value, count: 1 });
				}
			}
		}
		return [...counts.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
	}
}
