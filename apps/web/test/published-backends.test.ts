/**
 * The published backend list (`/backends.json`, from `deploy/backends.example.json`): what it may suggest, and the address
 * helpers the add form uses. The domain a bare name expands under is derived, never written here.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	baseDomainFrom,
	expandBackendAddress,
	fetchPublishedBackends,
	MAX_PUBLISHED_BACKENDS,
	missingPublished,
	nameFromBackendUrl,
	parsePublishedBackends,
	parsePublishedBackendsJson,
} from "../src/lib/published-backends.ts";

const repo = fileURLToPath(new URL("../../..", import.meta.url));
const published = parsePublishedBackendsJson(readFileSync(`${repo}deploy/backends.example.json`, "utf8"));

describe("published backend list", () => {
	test("reads the repo's list as the app ships it", () => {
		expect(published.map((entry) => entry.name)).toEqual(["backend-pc", "backend-vm", "backend-laptop"]);
		expect(published.map((entry) => entry.url)).toEqual([
			"https://backend-pc.example.test",
			"https://backend-vm.example.test",
			"https://backend-laptop.example.test",
		]);
		for (const entry of published) expect(entry.url.startsWith("https://")).toBe(true);
	});

	test("normalises entries and drops anything a backend could not be", () => {
		const entries = parsePublishedBackends([
			{ name: " backend-pc ", url: "https://backend-pc.example.com/" },
			{ name: "duplicate", url: "https://backend-pc.example.com" },
			{ name: "backend-pc", url: "https://other.example.com" },
			{ name: "plain-http", url: "http://harness.example.com" },
			{ name: "loopback", url: "http://127.0.0.1:7317" },
			{ name: "", url: "https://empty.example.com" },
			{ name: "path", url: "https://path.example.com/app" },
			{ name: "not a url", url: "backend-pc" },
			{ name: 42, url: "https://typed.example.com" },
			null,
		]);
		expect(entries).toEqual([
			{ name: "backend-pc", url: "https://backend-pc.example.com" },
			{ name: "loopback", url: "http://127.0.0.1:7317" },
		]);
	});

	test("suggests nothing for anything that is not a list", () => {
		expect(parsePublishedBackends(undefined)).toEqual([]);
		expect(parsePublishedBackends({ backends: published })).toEqual([]);
		expect(parsePublishedBackendsJson("not json")).toEqual([]);
		expect(parsePublishedBackendsJson("{}")).toEqual([]);
	});

	test("stops at the cap", () => {
		const many = Array.from({ length: MAX_PUBLISHED_BACKENDS + 5 }, (_, index) => ({
			name: `backend-${index}`,
			url: `https://backend-${index}.example.com`,
		}));
		expect(parsePublishedBackends(many)).toHaveLength(MAX_PUBLISHED_BACKENDS);
	});

	test("a missing, failing or malformed file means no suggestions", async () => {
		const respond = (body: string, status = 200) =>
			(async () => new Response(body, { status })) as unknown as typeof fetch;
		expect(await fetchPublishedBackends(respond(JSON.stringify(published)))).toEqual(published);
		expect(await fetchPublishedBackends(respond("", 404))).toEqual([]);
		expect(await fetchPublishedBackends(respond("<html>"))).toEqual([]);
		expect(
			await fetchPublishedBackends((async () => {
				throw new Error("offline");
			}) as unknown as typeof fetch),
		).toEqual([]);
		expect(await fetchPublishedBackends(undefined)).toEqual([]);
	});

	test("offers only the backends this browser lacks, by URL", () => {
		expect(missingPublished(published, [])).toEqual(published);
		expect(missingPublished(published, ["https://backend-pc.example.test"])).toEqual([
			{ name: "backend-vm", url: "https://backend-vm.example.test" },
			{ name: "backend-laptop", url: "https://backend-laptop.example.test" },
		]);
	});
});

describe("the domain a bare name expands under", () => {
	test("comes from the published backends' common parent", () => {
		expect(baseDomainFrom(published)).toBe("example.test");
	});

	test("falls back to the app's own host", () => {
		expect(baseDomainFrom([], "https://harness.example.test")).toBe("example.test");
		expect(baseDomainFrom([], "http://localhost:5173")).toBeUndefined();
		expect(baseDomainFrom([], "https://127.0.0.1:5173")).toBeUndefined();
		expect(baseDomainFrom([])).toBeUndefined();
	});

	test("prefers the parent most published backends share", () => {
		expect(
			baseDomainFrom([
				{ name: "a", url: "https://a.home.example.com" },
				{ name: "b", url: "https://b.home.example.com" },
				{ name: "c", url: "https://c.other.example.org" },
			]),
		).toBe("home.example.com");
	});
});

describe("expanding what the user typed", () => {
	const context = { entries: published, appOrigin: "https://harness.example.test" };

	test("a published name is that backend", () => {
		expect(expandBackendAddress("backend-pc", context)).toBe("https://backend-pc.example.test");
		expect(expandBackendAddress("Backend-VM", context)).toBe("https://backend-vm.example.test");
	});

	test("a bare label gets the derived domain", () => {
		expect(expandBackendAddress("harness-desk", context)).toBe("https://harness-desk.example.test");
		expect(expandBackendAddress("harness-desk", { appOrigin: "https://harness.example.test" })).toBe(
			"https://harness-desk.example.test",
		);
	});

	test("a bare label with no domain to derive stays a host", () => {
		expect(expandBackendAddress("harness-desk")).toBe("https://harness-desk");
	});

	test("a host gets a scheme, and loopback keeps plain HTTP", () => {
		expect(expandBackendAddress("harness-desk.example.test", context)).toBe(
			"https://harness-desk.example.test",
		);
		expect(expandBackendAddress("https://harness-desk.example.test", context)).toBe(
			"https://harness-desk.example.test",
		);
		expect(expandBackendAddress("localhost:7317", context)).toBe("http://localhost:7317");
		expect(expandBackendAddress("127.0.0.1:7317", context)).toBe("http://127.0.0.1:7317");
		expect(expandBackendAddress("   ", context)).toBe("");
	});
});

describe("a name from an address", () => {
	test("is the host's first label", () => {
		expect(nameFromBackendUrl("https://backend-pc.example.test")).toBe("backend-pc");
		expect(nameFromBackendUrl("https://backend-vm.example.test")).toBe("backend-vm");
		expect(nameFromBackendUrl("https://backend.example.com")).toBe("backend");
	});

	test("is readable for loopback and addresses without a domain", () => {
		expect(nameFromBackendUrl("http://localhost:5173")).toBe("localhost");
		expect(nameFromBackendUrl("http://127.0.0.1:7317")).toBe("127.0.0.1");
		expect(nameFromBackendUrl("https://myhost")).toBe("myhost");
		expect(nameFromBackendUrl("not a url")).toBe("");
	});
});
