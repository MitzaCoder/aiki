import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

/** Read a JSON file, or undefined when it does not exist. A corrupt file throws instead of being replaced. */
export async function readJsonFile(path: string): Promise<unknown | undefined> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
	return JSON.parse(text) as unknown;
}

/**
 * Write JSON atomically: a private temp file in the same directory, then a rename. The file mode is always applied, so
 * a file created by an older version or another user cannot keep wider permissions.
 */
export async function writeJsonFile(path: string, value: unknown, mode = 0o600): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
	const handle = await open(temporary, "w", mode);
	try {
		await handle.writeFile(`${JSON.stringify(value, null, "\t")}\n`, "utf8");
		await handle.sync().catch(() => undefined);
	} finally {
		await handle.close();
	}
	try {
		await chmod(temporary, mode);
		await rename(temporary, path);
		await chmod(path, mode);
	} catch (error) {
		await unlink(temporary).catch(() => undefined);
		throw error;
	}
}
