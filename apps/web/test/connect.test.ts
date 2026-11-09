/**
 * The "connect another device" link: what it carries, what it refuses, and that it never leaves the fragment. The
 * round trip is what the phone does when it opens the link the laptop made.
 */
import { describe, expect, test } from "bun:test";
import {
	CONNECT_PAYLOAD_VERSION,
	connectHref,
	decodeConnectHash,
	decodeConnectPayload,
	encodeConnectList,
	isConnectUrl,
	MAX_CONNECT_BACKENDS,
	MAX_CONNECT_NAME_LENGTH,
	MAX_CONNECT_PAYLOAD_LENGTH,
	MAX_CONNECT_URL_LENGTH,
	shareableName,
} from "../src/lib/connect.ts";

const two = [
	{ name: "harness-pc", url: "https://harness-pc.example.test" },
	{ name: "harness-vm", url: "https://harness-vm.example.test" },
];

function encoded(name: string, url: string): string {
	return `${CONNECT_PAYLOAD_VERSION}.${btoa(`${name}\t${url}`).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

describe("a connect link", () => {
	test("carries its backends through the fragment, unchanged", () => {
		const payload = encodeConnectList(two);
		expect(payload.startsWith(`${CONNECT_PAYLOAD_VERSION}.`)).toBe(true);
		expect(decodeConnectPayload(payload)).toEqual({ ok: true, backends: two });
	});

	test("is a hash, so no server ever sees the list", () => {
		const link = connectHref("https://harness.example.test", two);
		expect(link.startsWith("https://harness.example.test/connect#")).toBe(true);
		expect(link.indexOf("?")).toBe(-1);
		expect(decodeConnectHash(link.slice(link.indexOf("#")))).toEqual({ ok: true, backends: two });
		// The payload alone and with the leading `#` are the same thing.
		expect(decodeConnectHash(encodeConnectList(two))).toEqual({ ok: true, backends: two });
	});

	test("trailing slashes and defaults do not change what a device gets", () => {
		expect(
			decodeConnectPayload(encodeConnectList([{ name: " harness-pc ", url: "https://harness-pc.example.com/" }])),
		).toEqual({ ok: true, backends: [{ name: "harness-pc", url: "https://harness-pc.example.com" }] });
	});

	test("the same backend twice is one backend", () => {
		const decoded = decodeConnectPayload(
			encodeConnectList([...two, { name: "again", url: "https://harness-pc.example.test" }]),
		);
		expect(decoded).toEqual({ ok: true, backends: two });
	});

	test("refuses to be made for an address a phone could not use", () => {
		expect(() => encodeConnectList([])).toThrow();
		expect(() => encodeConnectList([{ name: "local", url: "http://127.0.0.1:7317" }])).toThrow();
		expect(() => encodeConnectList([{ name: "path", url: "https://harness.example.com/app" }])).toThrow();
		expect(() => encodeConnectList([{ name: "secret", url: "https://user:secret@harness.example.com" }])).toThrow();
		expect(() => encodeConnectList([{ name: "", url: "https://harness.example.com" }])).toThrow();
		expect(() =>
			encodeConnectList(Array.from({ length: MAX_CONNECT_BACKENDS + 1 }, (_, index) => ({
				name: `backend-${index}`,
				url: `https://backend-${index}.example.com`,
			}))),
		).toThrow();
	});
});

describe("what a link can carry", () => {
	test("only an HTTPS origin, so the choices are filtered before a link is built", () => {
		expect(isConnectUrl("https://harness-pc.example.test")).toBe(true);
		expect(isConnectUrl("https://harness-pc.example.test/")).toBe(true);
		expect(isConnectUrl("http://127.0.0.1:7317")).toBe(false);
		expect(isConnectUrl("https://harness-pc.example.test/app")).toBe(false);
		expect(isConnectUrl("harness-pc")).toBe(false);
	});

	test("a name is trimmed and cut to what the format holds", () => {
		expect(shareableName("  harness-pc  ")).toBe("harness-pc");
		expect(shareableName("a".repeat(MAX_CONNECT_NAME_LENGTH + 20))).toHaveLength(MAX_CONNECT_NAME_LENGTH);
		expect(shareableName("   ")).toBe("backend");
		expect(shareableName("\u0007bell")).toBe("bell");
	});
});

describe("decoding a connect link", () => {
	test("rejects anything that is not this link format", () => {
		const invalid = (payload: string) => {
			const decoded = decodeConnectPayload(payload);
			expect(decoded.ok).toBe(false);
		};
		invalid("");
		invalid("v2.abc");
		invalid(`${CONNECT_PAYLOAD_VERSION}.`);
		invalid(`${CONNECT_PAYLOAD_VERSION}.abc.def`);
		invalid("v1.not base64!");
		invalid("v1.aGVsbG8"); // valid base64, but not one `name<TAB>url` line
		invalid(`v1.${"A".repeat(MAX_CONNECT_PAYLOAD_LENGTH)}`);
	});

	test("rejects a whole link when one address is not a plain HTTPS origin", () => {
		for (const url of [
			"http://harness-pc.example.test",
			"https://harness-pc.example.test/app",
			"https://harness-pc.example.test?x=1",
			"https://harness-pc.example.test#fragment",
			"https://user:secret@harness-pc.example.test",
			"harness-pc.example.test",
			`https://${"a".repeat(MAX_CONNECT_URL_LENGTH)}.example.com`,
			"",
		]) {
			const decoded = decodeConnectPayload(encoded("harness-pc", url));
			expect(decoded.ok).toBe(false);
		}
	});

	test("rejects names that are not names", () => {
		for (const name of ["", " ".repeat(3), "a".repeat(MAX_CONNECT_NAME_LENGTH + 1), "\u0007bell"]) {
			const decoded = decodeConnectPayload(encoded(name, "https://harness-pc.example.test"));
			expect(decoded.ok).toBe(false);
		}
		expect(decodeConnectPayload(encoded("harness pc", "https://harness-pc.example.test")).ok).toBe(true);
	});

	test("rejects more backends than a link carries", () => {
		const lines = Array.from(
			{ length: MAX_CONNECT_BACKENDS + 1 },
			(_, index) => `backend-${index}\thttps://backend-${index}.example.com`,
		).join("\n");
		const payload = `${CONNECT_PAYLOAD_VERSION}.${btoa(lines).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
		expect(decodeConnectPayload(payload)).toMatchObject({ ok: false });
	});

	test("names the problem in words a screen can show", () => {
		const decoded = decodeConnectPayload("v2.abc");
		expect(decoded.ok).toBe(false);
		if (!decoded.ok) expect(decoded.reason.length).toBeGreaterThan(0);
		const broken = decodeConnectHash("#v1.####");
		expect(broken.ok).toBe(false);
		if (!broken.ok) expect(broken.reason).toContain("damaged");
	});
});
