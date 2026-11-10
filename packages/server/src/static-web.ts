import { realpath, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

/** Only fixed loopback authorities, never a reflected Host or arbitrary same-origin URL. */
export function localWebOrigin(origin: string | null, port: number): boolean {
	return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

/** Public files only; realpath also keeps symlinks from escaping the shipped web tree. */
export async function serveWeb(request: Request, directory: string): Promise<Response> {
	if (request.method !== "GET" && request.method !== "HEAD") {
		return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
	}
	const url = new URL(request.url);
	let path: string;
	try { path = decodeURIComponent(url.pathname); } catch { return new Response("Bad path", { status: 400 }); }
	if (path.includes("\0") || path.includes("\\") || path.split("/").some((part) => part.startsWith("."))) {
		return new Response("Not found", { status: 404 });
	}
	if (path === "/aiki-local.json" || path === "/backends.json") {
		return new Response(request.method === "HEAD" ? null : path === "/backends.json" ? "[]" : '{"local":true}', {
			headers: { "content-type": "application/json", "cache-control": "no-store" },
		});
	}
	const root = await realpath(directory);
	async function publicFile(name: string): Promise<string | undefined> {
		try {
			const file = await realpath(resolve(root, `.${name}`));
			if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) return undefined;
			return file;
		} catch { return undefined; }
	}
	let file = await publicFile(path === "/" ? "/index.html" : path);
	if (file === undefined && !extname(path)) file = await publicFile("/200.html");
	if (file === undefined) return new Response("Not found", { status: 404 });
	const asset = Bun.file(file);
	return new Response(request.method === "HEAD" ? null : asset, {
		headers: {
			"content-type": asset.type,
			"content-length": String(asset.size),
			"cache-control": path.startsWith("/_app/immutable/") ? "public, max-age=31536000, immutable" : "no-store",
			"x-content-type-options": "nosniff",
			"referrer-policy": "no-referrer",
		},
	});
}
