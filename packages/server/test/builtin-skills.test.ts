import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { builtinSkillFiles, builtinSkillsDirectory } from "../src/builtin-skills.ts";
import { renderSkills } from "../src/context.ts";
import { packagedResources } from "../src/packaged-resources.ts";

function fixture(run: (root: string) => void): void {
	const root = mkdtempSync(join(tmpdir(), "kemiri-builtin-skills-"));
	try { run(root); }
	finally { delete packagedResources.skills; rmSync(root, { recursive: true, force: true }); }
}

function writeAsset(directory: string, name: string, bytes: string | Uint8Array): void {
	const path = join(directory, name);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, bytes);
}

const skillBody = "---\nname: example\ndescription: Design HTML pages.\n---\nRead templates/report.html.";

function renderExample(directory: string): string {
	return renderSkills([{
		name: "example", description: "Design HTML pages.", path: join(directory, "example/SKILL.md"),
		source: "harness", scope: "global", origin: "builtin", hides: [],
	}])!;
}

test("identical source releases render byte-identical skills; content and filename edits change the path", () => fixture(root => {
	const config = join(root, "config");
	const releases = [join(root, "release-a/skills"), join(root, "release-b/skills")];
	for (const release of releases) {
		writeAsset(release, "example/SKILL.md", skillBody);
		writeAsset(release, "example/templates/report.html", "<!doctype html>Example");
	}
	const first = builtinSkillsDirectory(config, releases[0]);
	const second = builtinSkillsDirectory(config, releases[1]);
	expect(first).toBe(second);
	expect(first).toStartWith(join(config, "builtin-skills") + "/");
	const prompt = renderExample(first);
	expect(prompt).toContain(join(first, "example/SKILL.md"));
	expect(Buffer.from(renderExample(second))).toEqual(Buffer.from(prompt));
	expect(prompt).not.toContain("release-a");
	expect(prompt).not.toContain("release-b");
	// A template-only edit must also invalidate the path in the catalogue.
	writeAsset(releases[1]!, "example/templates/report.html", "<!doctype html>Updated");
	const changed = builtinSkillsDirectory(config, releases[1]);
	expect(changed).not.toBe(first);
	expect(renderExample(changed)).not.toBe(prompt);
	expect(readFileSync(join(first, "example/templates/report.html"), "utf8")).toBe("<!doctype html>Example");
	renameSync(join(releases[1]!, "example/templates/report.html"), join(releases[1]!, "example/templates/renamed.html"));
	expect(builtinSkillsDirectory(config, releases[1])).not.toBe(changed);
	expect(existsSync(changed)).toBe(true); // Never prune copies an old server may still use.
}));

test("source and binary assets share a hash regardless of entry order, with all skill folders and nested bytes", () => fixture(root => {
	const source = join(root, "source");
	writeAsset(source, "example/SKILL.md", skillBody);
	writeAsset(source, "example/templates/report.html", "<!doctype html>Example");
	writeAsset(source, "another/SKILL.md", "Another skill");
	writeAsset(source, "another/assets/sample.bin", new Uint8Array([0, 255, 1, 128]));
	const files = builtinSkillFiles(source); // The binary builder uses this same enumeration.
	expect(Object.keys(files).sort()).toEqual([
		"another/SKILL.md", "another/assets/sample.bin", "example/SKILL.md", "example/templates/report.html",
	]);
	const directory = builtinSkillsDirectory(join(root, "config"), source);
	packagedResources.skills = Object.fromEntries(Object.entries(files).reverse());
	expect(builtinSkillsDirectory(join(root, "config"), join(root, "nonexistent"))).toBe(directory);
	for (const [name, path] of Object.entries(files)) expect(readFileSync(join(directory, name))).toEqual(readFileSync(path));
}));

for (const compiled of [false, true]) {
	test(`${compiled ? "binary" : "source"} skill copies are private, unchanged files are not rewritten, and damaged copies are repaired`, () => fixture(root => {
		const source = join(root, "source");
		writeAsset(source, "example/SKILL.md", skillBody);
		writeAsset(source, "example/templates/report.html", "<!doctype html>Example");
		if (compiled) packagedResources.skills = builtinSkillFiles(source);
		const config = join(root, "config");
		const directory = builtinSkillsDirectory(config, source);
		const body = join(directory, "example/SKILL.md");
		const template = join(directory, "example/templates/report.html");
		for (const path of [directory, dirname(body), dirname(template)]) expect(statSync(path).mode & 0o777).toBe(0o700);
		for (const path of [body, template]) expect(statSync(path).mode & 0o777).toBe(0o600);
		utimesSync(body, 1000, 1000);
		utimesSync(template, 1000, 1000);
		expect(builtinSkillsDirectory(config, source)).toBe(directory);
		expect(statSync(body).mtimeMs).toBe(1_000_000);
		expect(statSync(template).mtimeMs).toBe(1_000_000);
		writeFileSync(template, "Changed");
		rmSync(body);
		expect(builtinSkillsDirectory(config, source)).toBe(directory);
		expect(readFileSync(body, "utf8")).toBe(skillBody);
		expect(readFileSync(template, "utf8")).toBe("<!doctype html>Example");
		rmSync(dirname(template), { recursive: true });
		expect(builtinSkillsDirectory(config, source)).toBe(directory);
		expect(readFileSync(template, "utf8")).toBe("<!doctype html>Example");
	}));
}

test("bundled paths reject traversal, absolute paths, separators and unsupported filename characters before copying", () => fixture(root => {
	const source = join(root, "asset");
	writeFileSync(source, "Example");
	for (const name of ["../escape", "example/../escape", "./SKILL.md", "/example/SKILL.md", "example//SKILL.md", "example/back\\slash", "example/white space", "example/under_score", "SKILL.md"]) {
		packagedResources.skills = { [name]: source };
		expect(() => builtinSkillsDirectory(join(root, "config"))).toThrow();
	}
	expect(existsSync(join(root, "config"))).toBe(false);
}));

test("source enumeration rejects unsafe filenames and symlinks", () => fixture(root => {
	const source = join(root, "source");
	writeAsset(source, "example/white space", "Example");
	expect(() => builtinSkillFiles(source)).toThrow("Invalid bundled skill filename");
	rmSync(join(source, "example/white space"));
	writeAsset(source, "example/SKILL.md", skillBody);
	symlinkSync(join(source, "example/SKILL.md"), join(source, "example/link.md"));
	expect(() => builtinSkillFiles(source)).toThrow("Bundled skill assets must be regular files or directories");
}));

test("hash input frames names and contents so file boundaries cannot alias", () => fixture(root => {
	const source = join(root, "source");
	const config = join(root, "config");
	writeAsset(source, "example/a", "xexample/by");
	writeAsset(source, "example/b", "z");
	const first = builtinSkillsDirectory(config, source);
	writeAsset(source, "example/a", "x");
	writeAsset(source, "example/b", "yexample/bz");
	expect(builtinSkillsDirectory(config, source)).not.toBe(first);
}));
