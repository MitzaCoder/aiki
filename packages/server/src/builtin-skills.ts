/** Bundled lazy skills: source paths in checkouts, private read-tool-readable copies in compiled releases. */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { packagedResources } from "./packaged-resources.ts";

export function builtinSkillsDirectory(configDir: string): string {
	const assets = packagedResources.skills;
	if (assets === undefined) return join(import.meta.dir, "../skills");
	const contents = Object.entries(assets).map(([name, path]) => [name, readFileSync(path)] as const);
	const hash = createHash("sha256");
	for (const [name, bytes] of contents) hash.update(name).update(bytes);
	const directory = join(configDir, "builtin-skills", hash.digest("hex").slice(0, 16));
	const skill = join(directory, "html-artifacts");
	mkdirSync(skill, { recursive: true, mode: 0o700 });
	for (const [name, bytes] of contents) {
		if (!/^[a-zA-Z0-9.-]+$/.test(name)) throw new Error("Invalid bundled skill filename");
		const path = join(skill, name);
		// Repair missing/changed copies, but don't rewrite them on every prompt render.
		let same = false;
		try { same = readFileSync(path).equals(bytes); } catch { /* First materialization. */ }
		if (!same) writeFileSync(path, bytes, { mode: 0o600 });
	}
	return directory;
}
