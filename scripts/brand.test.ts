import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const read = (path: string) => readFile(resolve(import.meta.dir, "..", path), "utf8");

test("reviewed candlenut masters stay lightweight, transparent vectors", async () => {
	for (const name of ["logo.svg", "logo-mark-mono.svg"]) {
		const svg = await read(`assets/brand/${name}`);
		expect(Buffer.byteLength(svg)).toBeLessThan(4096);
		expect(svg).toContain('viewBox="260 165 504 695"');
		expect(svg).not.toMatch(/<image|data:|<filter|<rect/);
		expect(svg).toContain("<path");
	}
	const mono = await read("assets/brand/logo-mark-mono.svg");
	expect(mono).toContain('fill="currentColor" fill-rule="evenodd"');
	expect(mono).not.toContain("Gradient");
	// The two eye contours and smile are true cutouts, not painted dark features.
	for (const contour of ["M453 592", "ZM633 592", "ZM485 626"]) expect(mono).toContain(contour);
});
