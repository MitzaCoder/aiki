/**
 * Publish untracked local `backends.json` as `/backends.json` beside the app. One local file, one file served: the build
 * emits it into the static output (which `deploy/web.sh` then copies into the release) and the dev server answers the
 * same path from the same file, so the list a browser is offered cannot drift from the local configuration.
 *
 * A missing file is not an error — the app suggests nothing — but a file that is not a valid list fails the build,
 * rather than shipping a broken first-run screen.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { parsePublishedBackendsJson, PUBLISHED_BACKENDS_PATH } from "./src/lib/published-backends.ts";

/** An explicit stable path survives archive builds; missing local config means no suggestions. */
export function findPublishedBackendsSource(env = process.env, root = fileURLToPath(new URL("../..", import.meta.url))): string | undefined {
	const path = env.KEMIRI_PUBLISHED_BACKENDS_FILE || env.AIKI_PUBLISHED_BACKENDS_FILE || resolve(env.DEPLOY_CONFIG_DIR || resolve(root, "deploy/local"), "backends.json");
	return existsSync(path) ? path : undefined;
}

/** Read and validate the list once per build; undefined when the repo has none. */
function readPublished(path: string | undefined): string | undefined {
	if (path === undefined) return undefined;
	const text = readFileSync(path, "utf8");
	const backends = parsePublishedBackendsJson(text);
	if (backends.length === 0) {
		if (text.trim() === "[]") return text;
		throw new Error(
			`${path} is not a list of backends: expected a JSON array of { name, url } with HTTPS origins.`,
		);
	}
	return JSON.stringify(backends, null, "\t") + "\n";
}

export function publishedBackends(): Plugin {
	return {
		name: "published-backends",
		// The static app is the client build; the server build (SvelteKit's manifest) needs no copy.
		applyToEnvironment: (environment) => environment.name === "client",
		configureServer(server) {
			server.middlewares.use((request, response, next) => {
				const path = (request.url ?? "").split("?")[0];
				if (path !== PUBLISHED_BACKENDS_PATH) return next();
				const body = readPublished(findPublishedBackendsSource());
				if (body === undefined) {
					response.statusCode = 404;
					response.end();
					return;
				}
				response.setHeader("content-type", "application/json; charset=utf-8");
				response.setHeader("cache-control", "no-cache");
				response.end(body);
			});
		},
		generateBundle() {
			const body = readPublished(findPublishedBackendsSource());
			if (body === undefined) return;
			this.emitFile({ type: "asset", fileName: "backends.json", source: body });
		},
	};
}
