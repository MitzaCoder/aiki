import "./clean-env.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findPublishedBackendsSource } from "../../apps/web/vite-plugin-published-backends.ts";
import { parseTargets, resolveTargetsFile } from "../targets.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "aiki-deploy-config-")); roots.push(root);
	const deploy = join(root, "deploy"); mkdirSync(join(deploy, "local"), { recursive: true });
	return { root, deploy, local: join(deploy, "local") };
}

describe("private deployment configuration", () => {
	test("prefers local targets, supports a stable explicit directory and retains the old in-tree fallback", () => {
		const { deploy, local } = fixture();
		expect(resolveTargetsFile({}, deploy)).toBeUndefined();
		writeFileSync(join(deploy, "targets.json"), "[]");
		expect(resolveTargetsFile({}, deploy)).toBe(join(deploy, "targets.json"));
		writeFileSync(join(local, "targets.json"), "[]");
		expect(resolveTargetsFile({}, deploy)).toBe(join(local, "targets.json"));
		expect(resolveTargetsFile({ DEPLOY_CONFIG_DIR: local }, "/nonexistent/archive/deploy")).toBe(join(local, "targets.json"));
		expect(resolveTargetsFile({ DEPLOY_TARGETS_FILE: "/explicit/example.json" }, deploy)).toBe("/explicit/example.json");
	});
	test("never automatically deploys the public example targets", () => {
		const { deploy } = fixture(); writeFileSync(join(deploy, "targets.example.json"), "[]");
		expect(resolveTargetsFile({}, deploy)).toBeUndefined();
	});
	test("web discovery follows the stable path across an archive and missing config means none", () => {
		const { root, local } = fixture();
		expect(findPublishedBackendsSource({}, root)).toBeUndefined();
		const list = join(local, "backends.json"); writeFileSync(list, "[]");
		expect(findPublishedBackendsSource({}, root)).toBe(list);
		expect(findPublishedBackendsSource({ DEPLOY_CONFIG_DIR: local }, "/nonexistent/archive")).toBe(list);
		expect(findPublishedBackendsSource({ AIKI_PUBLISHED_BACKENDS_FILE: list }, "/nonexistent/archive")).toBe(list);
		expect(findPublishedBackendsSource({ AIKI_PUBLISHED_BACKENDS_FILE: list + ".missing" }, root)).toBeUndefined();
	});
	test("example targets parse without any operator configuration", () => {
		const example = readFileSync(join(import.meta.dir, "../targets.example.json"), "utf8");
		expect(parseTargets(example, {}).map((target) => target.name)).toEqual(["vm", "laptop"]);
	});
	test("deploy passes a stable published list into archive builds and prefers the private user unit", () => {
		const source = readFileSync(join(import.meta.dir, "../deploy.sh"), "utf8");
		expect(source.indexOf("export AIKI_PUBLISHED_BACKENDS_FILE=")).toBeLessThan(source.indexOf("git archive --format=tar"));
		expect(source).toContain('if [[ -f $DEPLOY_CONFIG_DIR/aiki.service ]]; then unit_dir=$DEPLOY_CONFIG_DIR; fi');
	});
});
