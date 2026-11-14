/** Bundled lazy skills: private, content-addressed copies shared by source and compiled releases. */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { packagedResources } from "./packaged-resources.ts";

function validateSkillPath(name: string): void {
	const parts = name.split("/");
	if (parts.some(part => !/^[a-zA-Z0-9.-]+$/.test(part) || part === "." || part === "..")) {
		throw new Error("Invalid bundled skill filename");
	}
}

/** All files under each skill folder, keyed by relative path; also used by the binary builder. */
export function builtinSkillFiles(sourceDirectory: string): Record<string, string> {
	const files: Record<string, string> = {};
	function visit(directory: string, prefix = ""): void {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const name = prefix ? `${prefix}/${entry.name}` : entry.name;
			validateSkillPath(name);
			const path = join(directory, entry.name);
			if (entry.isDirectory()) visit(path, name);
			else if (entry.isFile()) {
				if (prefix) files[name] = path;
			} else throw new Error("Bundled skill assets must be regular files or directories");
		}
	}
	visit(sourceDirectory);
	return files;
}

export function builtinSkillsDirectory(configDir: string, sourceDirectory = join(import.meta.dir, "../skills")): string {
	const assets = packagedResources.skills ?? builtinSkillFiles(sourceDirectory);
	const contents = Object.keys(assets).sort().map(name => {
		validateSkillPath(name);
		if (!name.includes("/")) throw new Error("Bundled skill files must be inside a skill folder");
		return [name, readFileSync(assets[name]!)] as const;
	});
	const hash = createHash("sha256");
	for (const [name, bytes] of contents) hash.update(JSON.stringify([name, bytes.length])).update(bytes);
	const directory = join(configDir, "builtin-skills", hash.digest("hex").slice(0, 16));
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	for (const [name, bytes] of contents) {
		const path = join(directory, name);
		mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
		// Repair missing/changed copies, but don't rewrite them on every prompt render.
		let same = false;
		try { same = readFileSync(path).equals(bytes); } catch { /* First materialization. */ }
		if (!same) writeFileSync(path, bytes, { mode: 0o600 });
	}
	return directory;
}
