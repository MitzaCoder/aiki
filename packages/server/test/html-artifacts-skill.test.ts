import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { loadAgentContext, renderSkills } from "../src/context.ts";
import { builtinSkillsDirectory } from "../src/builtin-skills.ts";

const directory = join(import.meta.dir, "../skills/html-artifacts");

test("every fresh project offers the bundled short-description skill without its body", async () => {
	const root = await mkdtemp(join(tmpdir(), "aiki-html-skill-"));
	try {
		const context = loadAgentContext({ agentDir: root, configDir: root, claudeDir: root, cwd: root });
		const skill = context.skills.find((skill) => skill.name === "html-artifacts");
		expect(skill).toBeDefined();
		expect(skill?.source).toBe("harness");
		expect(skill?.description.length).toBeLessThan(160); // 25 cl100k_base tokens, measured independently.
		expect(dirname(skill!.path)).toBe(join(builtinSkillsDirectory(root), "html-artifacts"));
		for (const name of ["SKILL.md", "report.html", "proof-index.html", "dashboard.html", "deck.html", "tokens.css", "cdn.json"]) {
			expect(await readFile(join(dirname(skill!.path), name))).toEqual(await readFile(join(directory, name)));
		}
		const prompt = renderSkills(context.skills)!;
		expect(prompt).toContain(skill!.description);
		expect(prompt).not.toContain("Never depend on browser storage");
		expect(await readFile(skill!.path, "utf8")).toContain("artifact_save");
	} finally { await rm(root, { recursive: true, force: true }); }
});

for (const name of ["report", "proof-index", "dashboard", "deck"]) {
	test(`${name} parses as a standalone accessible document without relative resource links`, async () => {
		const html = await readFile(join(directory, `${name}.html`), "utf8");
		expect(html.toLowerCase().startsWith("<!doctype html>")).toBe(true);
		const counts: Record<string, number> = {};
		const rewriter = new HTMLRewriter();
		for (const selector of ["html[lang]", "head", "title", "body", "main", "h1", 'meta[name="viewport"]']) {
			rewriter.on(selector, { element() { counts[selector] = (counts[selector] ?? 0) + 1; } });
		}
		rewriter.on("*", { element(element) {
			for (const name of ["src", "href", "poster"]) {
				const link = element.getAttribute(name);
				if (link !== null) expect(link).toMatch(/^(https:\/\/|data:|blob:|#)/);
			}
			if (element.tagName === "img") expect(element.getAttribute("alt")).toBeTruthy();
		} });
		await rewriter.transform(new Response(html)).text();
		for (const count of Object.values(counts)) expect(count).toBeGreaterThan(0);
		expect(Object.keys(counts)).toHaveLength(7);
		expect(html).toContain("prefers-color-scheme:dark");
		expect(html).toContain('data-theme="light"');
		expect(html).toContain('data-theme="dark"');
		expect(html).toContain("@media print");
		expect(html).not.toMatch(/url\((?!['"]?(?:data:|https:|#))/);
	});
}

test("CDN allowlist has exact versions and SHA-384 integrity for all three optional libraries", async () => {
	const cdn = JSON.parse(await readFile(join(directory, "cdn.json"), "utf8"));
	expect(Object.keys(cdn)).toHaveLength(3);
	for (const entry of Object.values(cdn) as {url:string;integrity:string;crossorigin:string}[]) {
		expect(entry.url).toMatch(/^https:\/\/cdnjs.cloudflare.com\/ajax\/libs\/[^/]+\/\d+\.\d+\.\d+\//);
		expect(entry.integrity).toMatch(/^sha384-[A-Za-z0-9+/]{64}$/);
		expect(entry.crossorigin).toBe("anonymous");
	}
});
