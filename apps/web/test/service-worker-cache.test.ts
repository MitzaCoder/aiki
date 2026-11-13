import { expect, test } from "bun:test";
import { bypassAppCache, cacheNetworkResponse } from "../src/service-worker/cache-policy.ts";

for (const path of ["/artifacts/p/a?token=synthetic", "/artifacts/p/a~2?token=synthetic"])
	test(`signed artifact ${path} bypasses the app shell, even without Range`, () => {
		expect(bypassAppCache(new Request(`https://app.example.test${path}`))).toBe(true);
	});

test("all range requests bypass the app shell, not just video extensions", () => {
	expect(bypassAppCache(new Request("https://app.example.test/file", { headers: { Range: "bytes=0-" } }))).toBe(true);
	expect(bypassAppCache(new Request("https://app.example.test/backends.json"))).toBe(false);
	expect(bypassAppCache(new Request("https://app.example.test/b/demo/projects/p"))).toBe(false);
});

function cacheStorage(failure?: "open" | "put") {
	const writes: { request: Request; response: Response }[] = [];
	let opens = 0;
	const storage = {
		open: async () => {
			opens += 1;
			if (failure === "open") throw new Error("Storage unavailable");
			return { put: async (request: Request, response: Response) => {
				// Browser Cache.put rejects Partial Content, even though Response.ok is true.
				if (response.status === 206) throw new TypeError("Partial response (status code 206) is unsupported");
				if (failure === "put") throw new Error("Quota exceeded");
				writes.push({ request, response });
			} };
		},
	} as unknown as CacheStorage;
	return { storage, writes, opens: () => opens };
}

const request = new Request("https://app.example.test/file");
for (const headers of [{}, { "Cache-Control": "private, no-store" }])
	test(`206 never enters Cache.put (${JSON.stringify(headers)})`, async () => {
		const cache = cacheStorage();
		const response = new Response("bytes", { status: 206, headers });
		await cacheNetworkResponse(cache.storage, "test", request, response);
		expect(cache.opens()).toBe(0);
		expect(await response.text()).toBe("bytes");
	});

test("private no-store full responses are not retained either", async () => {
	const cache = cacheStorage();
	await cacheNetworkResponse(cache.storage, "test", request, new Response("private", { headers: { "Cache-Control": "private, no-store" } }));
	expect(cache.opens()).toBe(0);
});

for (const failure of ["open", "put"] as const)
	test(`cache ${failure} failures do not reject or consume the good network response`, async () => {
		const cache = cacheStorage(failure);
		const response = new Response("online");
		await cacheNetworkResponse(cache.storage, "test", request, response);
		expect(await response.text()).toBe("online");
	});

test("ordinary successful runtime responses still cache a clone", async () => {
	const cache = cacheStorage();
	const response = new Response("online");
	await cacheNetworkResponse(cache.storage, "test", request, response);
	expect(cache.writes).toHaveLength(1);
	expect(await cache.writes[0]!.response.text()).toBe("online");
	expect(await response.text()).toBe("online");
});
