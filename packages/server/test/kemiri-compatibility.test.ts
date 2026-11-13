import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadServerEnv } from "../src/server-env.ts";
import { defaultProductDirectory, resolveDataDir } from "../src/data-dir.ts";
import { childEnvironment } from "../src/child-environment.ts";
import { taskTrailers } from "../src/task-changes.ts";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() { const root = mkdtempSync(join(tmpdir(), "kemiri-env-")); roots.push(root); return root; }

test("aliases resolve by layer before spelling; empty canonical values remain explicit", () => {
	const root = fixture(), file = join(root, "server.env");
	writeFileSync(file, "KEMIRI_PORT=8001\nAIKI_PORT=8002\nKEMIRI_HOST=localhost\nAIKI_HOST=other\n");
	const warning = spyOn(console, "error").mockImplementation(() => {});
	try {
		const settings = loadServerEnv({ KEMIRI_ENV_FILE: file, AIKI_ENV_FILE: join(root, "missing"), AIKI_PORT: "9000", KEMIRI_HOST: "" });
		expect(warning).toHaveBeenCalledTimes(1);
		expect(settings.AIKI_PORT).toBe("9000"); expect(settings.KEMIRI_PORT).toBe("9000");
		expect(settings.AIKI_HOST).toBe("");
		const explicit = loadServerEnv({ KEMIRI_ENV_FILE: file, KEMIRI_PORT: "9100", AIKI_PORT: "9200" });
		expect(explicit.AIKI_PORT).toBe("9100");
		expect(warning.mock.calls.flat().join(" ")).not.toContain("8001");
		expect(warning.mock.calls.flat().join(" ")).not.toContain("9200");
	} finally { warning.mockRestore(); }
});

test("either child marker prevents rediscovery; explicit new env file opts back in", () => {
	const root = fixture(); mkdirSync(join(root, "kemiri"));
	const file = join(root, "kemiri/server.env"); writeFileSync(file, "KEMIRI_PORT=8123\n");
	for (const marker of ["AIKI_CHILD_PROCESS", "KEMIRI_CHILD_PROCESS"]) {
		expect(loadServerEnv({ XDG_CONFIG_HOME: root, [marker]: "1" }).AIKI_PORT).toBeUndefined();
		expect(loadServerEnv({ XDG_CONFIG_HOME: root, [marker]: "1", KEMIRI_ENV_FILE: file }).AIKI_PORT).toBe("8123");
	}
	expect(loadServerEnv({ XDG_CONFIG_HOME: root, AIKI_CHILD_PROCESS: "1", KEMIRI_CHILD_PROCESS: "0" }).AIKI_PORT).toBeUndefined();
	expect(() => loadServerEnv({ KEMIRI_ENV_FILE: join(root, "missing") })).toThrow();
	expect(childEnvironment({ AIKI_FUTURE_SETTING: "private", KEMIRI_FUTURE_SETTING: "private", PATH: "/bin" })).toEqual({ PATH: "/bin", AIKI_CHILD_PROCESS: "1", KEMIRI_CHILD_PROCESS: "1" });
});

test("fresh defaults, legacy reuse, same-realpath alias, explicit paths and ambiguous stores", () => {
	const root = fixture(); expect(defaultProductDirectory(root)).toBe(join(root, "kemiri"));
	mkdirSync(join(root, "aiki")); writeFileSync(join(root, "aiki/auth.sqlite"), "synthetic");
	expect(defaultProductDirectory(root)).toBe(join(root, "aiki"));
	mkdirSync(join(root, "kemiri")); expect(defaultProductDirectory(root)).toBe(join(root, "aiki"));
	writeFileSync(join(root, "kemiri/auth.sqlite"), "other synthetic");
	expect(() => defaultProductDirectory(root)).toThrow("choose an explicit");
	expect(resolveDataDir({ XDG_DATA_HOME: root, KEMIRI_DATA_DIR: join(root, "chosen") })).toBe(join(root, "chosen"));
	rmSync(join(root, "kemiri"), { recursive: true }); symlinkSync(join(root, "aiki"), join(root, "kemiri"));
	expect(defaultProductDirectory(root)).toBe(join(root, "kemiri"));
});

test("both trailer spellings are permanent readers and deduplicate task IDs", () => {
	expect(taskTrailers("feat: example\n\nKemiri-Task: T1,T2\nAiki-Task: T2, T3\nkemiri-task: T1")).toEqual(["T1", "T2", "T3"]);
});
