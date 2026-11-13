import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadServerEnv, resolvedServerConfig } from "../src/server-env.ts";
import { stateKind } from "../src/state-identity.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() { const root = mkdtempSync(join(tmpdir(), "aiki-env-")); roots.push(root); return root; }

test("optional XDG env file fills only absent settings and parses quoted values", () => {
	const root = fixture(); mkdirSync(join(root, "aiki"));
	writeFileSync(join(root, "aiki/server.env"), 'KEMIRI_DATA_DIR="/tmp/example data"\nKEMIRI_CONFIG_DIR=/tmp/config\nKEMIRI_HOST=0.0.0.0\nKEMIRI_PORT=8123\nKEMIRI_ALLOWED_ORIGINS="https://app.example.test"\n');
	const env = { XDG_CONFIG_HOME: root, KEMIRI_PORT: "9000" } as Record<string, string | undefined>;
	const settings = loadServerEnv(env);
	expect(env.KEMIRI_DATA_DIR).toBeUndefined();
	expect(resolvedServerConfig(settings)).toMatchObject({ dataDir: "/tmp/example data", configDir: "/tmp/config", hostname: "0.0.0.0", port: 9000, allowedOrigins: ["https://app.example.test"] });
});

test("missing default is optional, explicit missing file and unexpected settings fail closed", () => {
	const root = fixture();
	expect(() => loadServerEnv({ XDG_CONFIG_HOME: root })).not.toThrow();
	expect(() => loadServerEnv({ KEMIRI_ENV_FILE: join(root, "missing") })).toThrow();
	const file = join(root, "invalid.env"); writeFileSync(file, "PATH=/untrusted\n");
	expect(() => loadServerEnv({ KEMIRI_ENV_FILE: file })).toThrow("only set KEMIRI_");
});

test("print-config loads settings before persistent identities without creating the data/config directories", () => {
	const root = fixture(); const file = join(root, "server.env");
	writeFileSync(file, `KEMIRI_DATA_DIR=${root}/untouched-data\nKEMIRI_CONFIG_DIR=${root}/untouched-config\nKEMIRI_STATE_NAMESPACE=previous\nKEMIRI_PROJECT_CONTEXT_DIR=.previous\nKEMIRI_HOST=0.0.0.0\nKEMIRI_PORT=8123\nKEMIRI_ALLOWED_ORIGINS=https://app.example.test\n`);
	const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("KEMIRI_")));
	const child = Bun.spawnSync([process.execPath, join(import.meta.dir, "../src/main.ts"), "--print-config"], { env: { ...env, KEMIRI_ENV_FILE: file } });
	expect(child.exitCode).toBe(0);
	expect(JSON.parse(child.stdout.toString())).toMatchObject({ stateNamespace: "previous", projectContextDir: ".previous", port: 8123 });
	expect(Bun.file(join(root, "untouched-data")).size).toBe(0);
	const kinds = Bun.spawnSync([process.execPath, "-e", `import { BoardDoc } from ${JSON.stringify(join(import.meta.dir, "../src/board.ts"))}; console.log(BoardDoc.definition.kind)`], { env: { ...env, KEMIRI_STATE_NAMESPACE: "previous" } });
	expect(kinds.exitCode).toBe(0);
	expect(kinds.stdout.toString().trim()).toBe("previous.board");
	expect(stateKind("board")).toBe("aiki.board");
});
