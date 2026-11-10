import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localWebOrigin, serveWeb } from "../src/static-web.ts";

const roots: string[] = [];
afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function setup() {
	const root = await mkdtemp(join(tmpdir(), "aiki-web-"));
	roots.push(root);
	const web = join(root, "web");
	await mkdir(join(web, "_app/immutable"), { recursive: true });
	await writeFile(join(web, "200.html"), "<h1>SPA</h1>");
	await writeFile(join(web, "_app/immutable/a.js"), "export {}");
	await writeFile(join(web, "push-worker.js"), 'self.addEventListener("push", () => {});');
	await writeFile(join(root, "secret"), "private");
	await symlink(join(root, "secret"), join(web, "escape.txt"));
	return (path: string, method = "GET") => serveWeb(new Request("http://localhost:7317" + path, { method }), web);
}
test("SPA, MIME, HEAD and cache headers", async () => {
	const serve = await setup();
	expect(await (await serve("/")).text()).toContain("SPA");
	expect(await (await serve("/settings/backends/local")).text()).toContain("SPA");
	const js = await serve("/_app/immutable/a.js");
	expect(js.headers.get("content-type")).toContain("javascript");
	expect(js.headers.get("cache-control")).toContain("immutable");
	expect((await serve("/")).headers.get("cache-control")).toBe("no-store");
	expect(await (await serve("/", "HEAD")).text()).toBe("");
	expect((await serve("/", "POST")).status).toBe(405);
});
test("root push script is JavaScript, uncached, and may register narrower scopes without a scope override", async () => {
	const serve = await setup();
	const response = await serve("/push-worker.js");
	expect(response.status).toBe(200);
	expect(response.headers.get("content-type")).toContain("javascript");
	expect(response.headers.get("cache-control")).toBe("no-store");
	expect(response.headers.get("service-worker-allowed")).toBeNull();
	expect(response.headers.get("x-content-type-options")).toBe("nosniff");
	expect(await response.text()).toContain('addEventListener("push"');
});
test("no file fallback, hidden paths, encoded traversal or symlink escapes", async () => {
	const serve = await setup();
	for (const path of ["/missing.js", "/.env", "/%2e%2e%2fsecret", "/escape.txt", "/bad%00", "/bad%ZZ", "/a%5cb"]) {
		expect((await serve(path)).status).toBeGreaterThanOrEqual(400);
	}
});
test("neutral suggestions and explicit local discovery", async () => {
	const serve = await setup();
	expect(await (await serve("/backends.json")).json()).toEqual([]);
	expect(await (await serve("/aiki-local.json")).json()).toEqual({ local: true });
});
test("fixed loopback origins only, including the actual port", () => {
	expect(localWebOrigin("http://127.0.0.1:7317", 7317)).toBe(true);
	expect(localWebOrigin("http://localhost:7317", 7317)).toBe(true);
	for (const origin of [null, "null", "http://example.test:7317", "http://localhost:7318", "https://localhost:7317"]) {
		expect(localWebOrigin(origin, 7317)).toBe(false);
	}
});
