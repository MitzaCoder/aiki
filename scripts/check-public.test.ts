import { describe, expect, test } from "bun:test";
import { publicCheckOptions, publicFileProblems } from "./check-public.ts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bytes = (text: string) => new TextEncoder().encode(text);
describe("public snapshot guard", () => {
	test("local mode fails closed without a nonempty denylist; CI explicitly skips only private terms", () => {
		const dir = mkdtempSync(join(tmpdir(), "public-guard-test-"));
		const path = join(dir, "denylist.txt");
		try {
			expect(() => publicCheckOptions([], path)).toThrow("Private denylist missing");
			expect(() => publicCheckOptions(["--require-scanner"], path)).toThrow("Private denylist missing");
			expect(publicCheckOptions(["--public-ci"], path)).toEqual({ terms: [], requireScanner: true });
			writeFileSync(path, "# comment\n\n");
			expect(() => publicCheckOptions([], path)).toThrow("at least one term");
			writeFileSync(path, "synthetic-private-term\n");
			expect(publicCheckOptions(["--require-scanner"], path)).toEqual({ terms: ["synthetic-private-term"], requireScanner: true });
			expect(publicCheckOptions(["--public-ci"], path)).toEqual({ terms: [], requireScanner: true });
			expect(() => publicCheckOptions(["--public-ci", `--denylist=${path}`], path)).toThrow("cannot be combined");
			expect(() => publicCheckOptions(["--skip-scanner"], path)).toThrow("Usage:");
			// Generic checks are the same with CI's empty term list.
			expect(publicFileProblems("secret.jks", bytes(""), publicCheckOptions(["--public-ci"], path).terms)).toContain("secret-bearing filename");
		} finally { rmSync(dir, { recursive: true, force: true }); }
	});
	test("exempts only the license copyright line, never the same name elsewhere", () => {
		const notice = "Copyright (c) 2026 Example Person";
		expect(publicFileProblems("LICENSE", bytes(notice), ["Example Person"])).toEqual([]);
		expect(publicFileProblems("LICENSE", bytes(`${notice}\nExample Person`), ["Example Person"])).toEqual(["private denylist entry 1"]);
		expect(publicFileProblems("README.md", bytes(notice), ["Example Person"])).toEqual(["private denylist entry 1"]);
	});
	test("matches private terms case-insensitively in paths and contents without echoing values", () => {
		const term = "private-example.example.invalid";
		expect(publicFileProblems("README.md", bytes(term.toUpperCase()), [term])).toEqual(["private denylist entry 1"]);
		expect(publicFileProblems(`${term}/file.txt`, bytes("safe"), [term])).toEqual(["private denylist entry 1"]);
	});
	test("word entries do not match a substring inside an unrelated identifier", () => {
		expect(publicFileProblems("file.txt", bytes("prefixprivatewordSuffix"), ["word:privateword"])).toEqual([]);
		expect(publicFileProblems("file.txt", bytes("privateword-project"), ["word:privateword"])).toEqual(["private denylist entry 1"]);
	});
	test("checks generic routing and personal-home patterns independently of private terms", () => {
		const address = [100, 64, 1, 2].join(".");
		const home = "/" + ["home", "example-person", "source"].join("/") + "/";
		expect(publicFileProblems("file.txt", bytes(address), [])).toContain("private-network address");
		expect(publicFileProblems("file.txt", bytes(home), [])).toContain("personal absolute home path");
		expect(publicFileProblems("file.txt", bytes("https://backend.example.test /home/user/source/"), [])).toEqual([]);
	});
	test("rejects credential file paths but allows env templates and source fixtures", () => {
		for (const path of [".env", ".env.production", "private.pem", "app/google-services.json", "notifications/vapid.json", "notifications/push-relay.json", "notifications/push-relay-counters.json"]) {
			expect(publicFileProblems(path, bytes(""), [])).toContain("secret-bearing filename");
		}
		for (const path of [".env.example", ".env.production.example", "packages/server/src/credentials.ts"]) {
			expect(publicFileProblems(path, bytes(""), [])).toEqual([]);
		}
	});
});
