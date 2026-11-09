import { describe, expect, test } from "bun:test";
import { publicFileProblems } from "./check-public.ts";

const bytes = (text: string) => new TextEncoder().encode(text);
describe("public snapshot guard", () => {
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
		for (const path of [".env", ".env.production", "private.pem", "app/google-services.json", "notifications/vapid.json"]) {
			expect(publicFileProblems(path, bytes(""), [])).toContain("secret-bearing filename");
		}
		for (const path of [".env.example", ".env.production.example", "packages/server/src/credentials.ts"]) {
			expect(publicFileProblems(path, bytes(""), [])).toEqual([]);
		}
	});
});
