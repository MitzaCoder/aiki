/**
 * The installable app's pieces: the two manifests (one per colour scheme), the icons they name, and the handlers the
 * service worker must register. A missing icon or manifest field is what makes a phone refuse to install the app.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${web}${path}`, "utf8");

type ManifestIcon = { src: string; sizes: string; type: string; purpose?: string };
type Manifest = {
	name?: string;
	short_name?: string;
	start_url?: string;
	scope?: string;
	display?: string;
	theme_color?: string;
	background_color?: string;
	icons?: ManifestIcon[];
};

function manifest(path: string): Manifest {
	return JSON.parse(read(path)) as Manifest;
}

/** A PNG's width and height from its IHDR, which sits right after the 8-byte signature. */
function pngSize(path: string): { width: number; height: number } {
	const bytes = readFileSync(`${web}${path}`);
	expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
	return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** The jarvis theme's background for one scheme, so the manifest cannot drift from the app it installs. */
function themeBackground(scheme: "light" | "dark"): string {
	const css = read("/src/lib/themes/jarvis.css");
	const block =
		scheme === "light"
			? /:root\[data-theme='jarvis'\],\s*:root:not\(\[data-theme\]\)(?:,\s*\[data-theme-preview='jarvis'\])?\s*\{([\s\S]*?)\}/.exec(css)?.[1]
			: /:root\[data-theme='jarvis'\]\.dark,\s*:root:not\(\[data-theme\]\)\.dark(?:,\s*\[data-theme-preview='jarvis'\]\.dark)?\s*\{([\s\S]*?)\}/.exec(css)?.[1];
	return /--tone-bg:\s*(#[0-9a-f]{6})/i.exec(block ?? "")?.[1] ?? "";
}

const manifests = [
	{ path: "/static/manifest.webmanifest", scheme: "dark" as const },
	{ path: "/static/manifest-light.webmanifest", scheme: "light" as const },
];

describe("web manifests", () => {
	for (const entry of manifests) {
		test(`${entry.path} installs as a standalone app`, () => {
			const value = manifest(entry.path);
			expect(value.name).toBe("Aiki");
			expect(value.short_name).toBe("Aiki");
			expect(value.start_url).toBe("/");
			expect(value.scope).toBe("/");
			expect(value.display).toBe("standalone");
			expect(value.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
			expect(value.background_color).toMatch(/^#[0-9a-f]{6}$/i);
		});

		test(`${entry.path} carries the ${entry.scheme} theme's colours`, () => {
			const value = manifest(entry.path);
			const background = themeBackground(entry.scheme);
			expect(background.length).toBe(7);
			expect(value.background_color?.toLowerCase()).toBe(background.toLowerCase());
			expect(value.theme_color?.toLowerCase()).toBe(background.toLowerCase());
		});

		test(`${entry.path} names 192 and 512 icons, plain and maskable`, () => {
			const icons = manifest(entry.path).icons ?? [];
			expect(icons.length).toBe(4);
			for (const icon of icons) {
				expect(icon.type).toBe("image/png");
				const [width, height] = icon.sizes.split("x").map(Number);
				expect(width).toBe(height);
				expect([192, 512]).toContain(width);
				expect(existsSync(`${web}/static${icon.src}`)).toBe(true);
				expect(pngSize(`/static${icon.src}`)).toEqual({ width, height });
			}
			expect(icons.some((icon) => icon.sizes === "192x192" && icon.purpose === "maskable")).toBe(true);
			expect(icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable")).toBe(true);
			expect(icons.some((icon) => icon.sizes === "192x192" && icon.purpose !== "maskable")).toBe(true);
			expect(icons.some((icon) => icon.sizes === "512x512" && icon.purpose !== "maskable")).toBe(true);
		});
	}

	test("both manifests carry the same identity", () => {
		const [dark, light] = manifests.map((entry) => manifest(entry.path));
		expect(light?.name).toBe(dark?.name);
		expect(light?.icons).toEqual(dark?.icons);
	});

	test("the page links both manifests, one per colour scheme", () => {
		const html = read("/src/app.html");
		expect(html).toContain('href="/manifest.webmanifest"');
		expect(html).toContain('href="/manifest-light.webmanifest"');
		expect(html).toContain("prefers-color-scheme: dark");
		expect(html).toContain("prefers-color-scheme: light");
	});
});

describe("the service worker", () => {
	test("handles push, a notification click and a replaced subscription", () => {
		const source = read("/src/service-worker/index.ts") + read("/src/service-worker/push-events.ts");
		for (const handler of [
			'"push"',
			'"notificationclick"',
			'"pushsubscriptionchange"',
			'"fetch"',
			'showNotification',
			'skipWaiting',
			'"/200.html"',
		]) {
			expect(source).toContain(handler);
		}
	});
});
