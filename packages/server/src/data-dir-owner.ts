import { createConnection } from "node:net";
import { join } from "node:path";

/** Below the deploy's 20-second health budget; ordinary systemd restarts already await the old process's exit. */
export const DATA_DIR_OWNER_WAIT_MS = 3000;
const OWNER_RETRY_MS = 100;

/** Missing/refused is reusable. A timeout or any unknown error must never justify unlinking a live socket. */
async function hasLiveOwner(dataDir: string): Promise<boolean> {
	return new Promise<boolean>((resolve, reject) => {
		const socket = createConnection({ path: join(dataDir, "auth.sock") });
		socket.once("connect", () => { socket.destroy(); resolve(true); });
		socket.once("error", (error: NodeJS.ErrnoException) => {
			socket.destroy();
			if (error.code === "ENOENT" || error.code === "ECONNREFUSED") resolve(false);
			else reject(new Error(`Cannot verify data directory owner for ${dataDir}; refusing to start`, { cause: error }));
		});
		socket.setTimeout(1000, () => {
			socket.destroy();
			reject(new Error(`Data directory owner socket is unresponsive for ${dataDir}; refusing to start`));
		});
	});
}

/**
 * Read-only preflight, before opening databases or keys. Allow a retiring owner a short grace period.
 * This detects an already-running owner, not a lock: simultaneous first starts and servers without an owner
 * socket still need an exclusive lifetime lock. Keep the socket until shutdown has finished all data writes.
 */
export async function assertDataDirNotOwned(dataDir: string): Promise<void> {
	const deadline = performance.now() + DATA_DIR_OWNER_WAIT_MS;
	while (await hasLiveOwner(dataDir)) {
		const remaining = deadline - performance.now();
		if (remaining <= 0) throw new Error(`Another live server owns data directory ${dataDir} (owner socket in use after ${DATA_DIR_OWNER_WAIT_MS}ms); refusing to start`);
		await Bun.sleep(Math.min(OWNER_RETRY_MS, remaining));
	}
}
