/** Signed files and byte ranges belong to the browser, never the offline app shell. */
export function bypassAppCache(request: Request): boolean {
	return request.headers.has("range") || new URL(request.url).pathname.startsWith("/artifacts/");
}

/** Cache storage is an optimization: a quota/partial-response failure must not hide a good network response. */
export async function cacheNetworkResponse(
	storage: CacheStorage,
	cacheName: string,
	request: Request,
	response: Response,
): Promise<void> {
	if (!response.ok || response.status === 206 || /\bno-store\b/i.test(response.headers.get("cache-control") ?? "")) return;
	try {
		const cache = await storage.open(cacheName);
		await cache.put(request, response.clone());
	} catch {
		// Offline caching may be unavailable or full. The caller still returns the network response.
	}
}
