import { execFileSync } from "node:child_process";
import type { Plugin } from "vite";
import { fileURLToPath } from "node:url";
/** One bundled, same-origin script at the root permits every narrower /push/<id>/ scope. */
export function pushWorker(): Plugin {
	async function script(): Promise<string> {
		return execFileSync(
			"bun",
			[
				"build",
				"--target=browser",
				"--minify",
				fileURLToPath(new URL("./src/service-worker/push-worker.ts", import.meta.url)),
			],
			{ encoding: "utf8" },
		);
	}
	return {
		name: "aiki-push-worker",
		configureServer(server) {
			server.middlewares.use("/push-worker.js", async (_request, response, next) => {
				try {
					response.setHeader("content-type", "text/javascript");
					response.setHeader("cache-control", "no-store");
					response.end(await script());
				} catch (error) {
					next(error);
				}
			});
		},
		async generateBundle() {
			this.emitFile({ type: "asset", fileName: "push-worker.js", source: await script() });
		},
	};
}
