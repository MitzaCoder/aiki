import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { builtinSkillsDirectory } from "../src/builtin-skills.ts";
import { packagedResources } from "../src/packaged-resources.ts";

test("binary skill assets materialize beside their templates and repair edited copies", () => {
	const root = mkdtempSync(join(tmpdir(), "aiki-builtin-skills-"));
	try {
		const body = join(root, "skill-source.md"), template = join(root, "template-source.html");
		writeFileSync(body, "---\nname: html-artifacts\ndescription: Design HTML pages.\n---\nRead report.html.");
		writeFileSync(template, "<!doctype html><html><body>Example</body></html>");
		packagedResources.skills = { "SKILL.md": body, "report.html": template };
		const directory = builtinSkillsDirectory(root);
		expect(readFileSync(join(directory, "html-artifacts", "SKILL.md"), "utf8")).toContain("Read report.html");
		const copy = join(directory, "html-artifacts", "report.html");
		expect(readFileSync(copy, "utf8")).toContain("Example");
		writeFileSync(copy, "Changed");
		expect(builtinSkillsDirectory(root)).toBe(directory);
		expect(readFileSync(copy, "utf8")).toContain("Example");
	} finally { delete packagedResources.skills; rmSync(root, { recursive: true, force: true }); }
});
