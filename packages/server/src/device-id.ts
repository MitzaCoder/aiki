/**
 * A stable per-installation ID. Sign in with ChatGPT identifies the agent host this way, and it must stay the same
 * across logins, so it lives in the data directory next to the credentials.
 */
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUsableId(value: string): boolean {
	return UUID_PATTERN.test(value);
}

/** Read the stored ID, or create one with 0600 permissions. A malformed file is replaced. */
export async function loadOrCreateDeviceId(path: string): Promise<string> {
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			const stored = (await readFile(path, "utf8")).trim();
			if (isUsableId(stored)) return stored;
			await rm(path, { force: true });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		const id = randomUUID();
		try {
			// "wx" so two racing starts settle on whichever wrote first instead of clobbering it.
			await writeFile(path, `${id}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
			return id;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
	}
	throw new Error(`Could not read or create a device ID at ${path}`);
}
