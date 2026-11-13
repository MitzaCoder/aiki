import { beforeAll, expect, test } from "bun:test";

let workerCode: string;
beforeAll(async () => {
	// Run the production fetch listener, not Vite dev mode (which bypasses the worker).
	const built = await Bun.build({
		entrypoints: [new URL("../src/service-worker/index.ts", import.meta.url).pathname],
		target: "browser",
		format: "iife",
		plugins: [{ name: "synthetic-worker-manifest", setup(build) {
			build.onResolve({ filter: /^\$app\/(env|manifest)$/ }, args => ({ path: args.path, namespace: "fixture" }));
			build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({
				contents: args.path.endsWith("env") ? 'export const dev=false, version="synthetic";' : "export const assets=[], immutable=[];",
				loader: "js",
			}));
		} }],
	});
	if (!built.success) throw new Error(String(built.logs));
	workerCode = await built.outputs[0]!.text();
});

function worker() {
	const listeners = new Map<string, (event: unknown) => void>();
	let fetches = 0;
	const scope = {
		registration: { scope: "https://app.example.test/" },
		location: { origin: "https://app.example.test" },
		addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener),
	};
	const storage = { open: async () => ({ match: async () => undefined, put: async () => { throw new Error("Cache unavailable"); } }) };
	const fetch = async () => { fetches++; return new Response("network bytes"); };
	new Function("self", "caches", "fetch", workerCode)(scope, storage, fetch);
	return {
		fetches: () => fetches,
		dispatch: (path: string, headers: Record<string, string> = {}, mode?: string) => {
			let response: Promise<Response> | undefined;
			const request = new Request(`https://app.example.test${path}`, { headers });
			if (mode) Object.defineProperty(request, "mode", { value: mode });
			listeners.get("fetch")!({ request, respondWith: (promise: Promise<Response>) => { response = promise; } });
			return response;
		},
	};
}

test("installed worker leaves signed media, downloads and navigations entirely to the browser", () => {
	const fixture = worker();
	expect(fixture.dispatch("/artifacts/p/a?token=synthetic", { Range: "bytes=0-" })).toBeUndefined();
	expect(fixture.dispatch("/artifacts/p/a?token=synthetic")).toBeUndefined();
	expect(fixture.dispatch("/artifacts/p/a?token=synthetic", {}, "navigate")).toBeUndefined();
	expect(fixture.dispatch("/other-media", { Range: "bytes=100-200" })).toBeUndefined();
	expect(fixture.fetches()).toBe(0);
});

test("cache write failure cannot turn a successful runtime or immutable response into a network error", async () => {
	const fixture = worker();
	for (const path of ["/backends.json", "/_app/immutable/synthetic.js"]) {
		const response = await fixture.dispatch(path);
		expect(response?.status).toBe(200);
		expect(await response?.text()).toBe("network bytes");
	}
});
