import { describe, expect, it } from "bun:test";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { homedir } from "node:os";
import { join } from "node:path";
import { ensureDataDir, resolveConfigDir, resolveDataDir, resolveHostname, resolvePort } from "../src/data-dir.ts";
import { HARNESS_PROVIDERS, createHarnessModels, describeModels } from "../src/models.ts";
import { isOriginAllowed, normalizeOrigin, parseAllowedOrigins, resolveAllowedOrigins } from "../src/origins.ts";

describe("data directory", () => {
	it("defaults to XDG_DATA_HOME/aiki and honours the override", () => {
		expect(resolveDataDir({ XDG_DATA_HOME: "/tmp/xdg" })).toBe("/tmp/xdg/aiki");
		expect(resolveDataDir({ AIKI_DATA_DIR: "/tmp/direct" })).toBe("/tmp/direct");
		expect(resolveDataDir({})).toBe(join(homedir(), ".local", "share", "aiki"));
	});

	it("keeps the harness's own config apart from pi's agent directory", () => {
		expect(resolveConfigDir({ XDG_CONFIG_HOME: "/tmp/xdg" })).toBe("/tmp/xdg/aiki");
		expect(resolveConfigDir({ AIKI_CONFIG_DIR: "/tmp/direct" })).toBe("/tmp/direct");
		expect(resolveConfigDir({ AIKI_CONFIG_DIR: "~/elsewhere" })).toBe(join(homedir(), "elsewhere"));
		expect(resolveConfigDir({ AIKI_CONFIG_DIR: "  " })).toBe(join(homedir(), ".config", "aiki"));
		expect(resolveConfigDir({})).toBe(join(homedir(), ".config", "aiki"));
	});

	it("binds the loopback interface unless told otherwise", () => {
		expect(resolveHostname({})).toBe("127.0.0.1");
		expect(resolveHostname({ AIKI_HOST: "  " })).toBe("127.0.0.1");
		expect(resolveHostname({ AIKI_HOST: "0.0.0.0" })).toBe("0.0.0.0");
		expect(resolveHostname({ AIKI_HOST: " vm.example.test " })).toBe("vm.example.test");
	});

	it("reads and validates the port", () => {
		expect(resolvePort({})).toBe(7317);
		expect(resolvePort({ AIKI_PORT: "0" })).toBe(0);
		expect(resolvePort({ AIKI_PORT: "9000" })).toBe(9000);
		expect(() => resolvePort({ AIKI_PORT: "nope" })).toThrow();
		expect(() => resolvePort({ AIKI_PORT: "70000" })).toThrow();
	});
});

describe("allowed origins", () => {
	it("defaults to none and parses a comma-separated list", () => {
		expect(resolveAllowedOrigins({})).toEqual([]);
		expect(resolveAllowedOrigins({ AIKI_ALLOWED_ORIGINS: "  " })).toEqual([]);
		expect(
			resolveAllowedOrigins({
				AIKI_ALLOWED_ORIGINS: "https://harness.example.test/, http://127.0.0.1:5173",
			}),
		).toEqual(["https://harness.example.test", "http://127.0.0.1:5173"]);
		expect(parseAllowedOrigins("https://a.example,https://a.example")).toEqual(["https://a.example"]);
	});

	it("rejects malformed entries and matches normalised origins only", () => {
		expect(() => parseAllowedOrigins("not a url")).toThrow();
		expect(() => parseAllowedOrigins("ftp://a.example")).toThrow();
		expect(normalizeOrigin("HTTPS://Example.COM/")).toBe("https://example.com");
		expect(normalizeOrigin("null")).toBeUndefined();
		expect(isOriginAllowed(null, [])).toBe(true);
		expect(isOriginAllowed("https://app.example", ["https://app.example"])).toBe(true);
		expect(isOriginAllowed("https://app.example/", ["https://app.example"])).toBe(true);
		expect(isOriginAllowed("https://evil.example", ["https://app.example"])).toBe(false);
		expect(isOriginAllowed("https://app.example", [])).toBe(false);
	});
});

describe("model setup", () => {
	it("registers exactly the three designed providers", () => {
		const models = createHarnessModels({ credentials: new InMemoryCredentialStore() });
		expect(models.getProviders().map((provider) => provider.id)).toEqual([...HARNESS_PROVIDERS]);
		expect(models.getProvider("opencode-go")?.name).toBeDefined();
	});

	it("describes the catalog without a network call", async () => {
		const models = createHarnessModels({ credentials: new InMemoryCredentialStore() });
		const catalog = await describeModels(models);
		expect(catalog.providers.map((provider) => provider.id)).toEqual([...HARNESS_PROVIDERS]);
		expect(catalog.models.length).toBeGreaterThan(0);
		for (const model of catalog.models) {
			expect(HARNESS_PROVIDERS as readonly string[]).toContain(model.provider);
			expect(model.contextWindow).toBeGreaterThan(0);
			expect(model.thinkingLevels.length).toBeGreaterThan(0);
		}
	});
});

describe("ensureDataDir", () => {
	it("creates the data directory and projects directory", async () => {
		const root = join(process.env["TMPDIR"] ?? "/tmp", `mh-ensure-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		try {
			await ensureDataDir(root);
			const { stat } = await import("node:fs/promises");
			expect((await stat(root)).isDirectory()).toBe(true);
			expect((await stat(join(root, "projects"))).isDirectory()).toBe(true);
			expect((await stat(root)).mode & 0o777).toBe(0o700);
		} finally {
			const { rm } = await import("node:fs/promises");
			await rm(root, { recursive: true, force: true });
		}
	});
});
