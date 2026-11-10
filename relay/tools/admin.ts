import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const state = resolve(root, ".emulator");
for (const path of ["home", "config", "cache"]) mkdirSync(resolve(state, path), { recursive: true });
const environment = {
	PATH: process.env.PATH!,
	HOME: resolve(state, "home"),
	XDG_CONFIG_HOME: resolve(state, "config"),
	XDG_CACHE_HOME: resolve(state, "cache"),
	GCLOUD_PROJECT: "demo-aiki-relay",
	METADATA_SERVER_DETECTION: "none",
	FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:" + (process.env.RELAY_AUTH_PORT ?? "19371"),
	FIRESTORE_EMULATOR_HOST: "127.0.0.1:" + (process.env.RELAY_FIRESTORE_PORT ?? "19372"),
};
const child = Bun.spawn(
	[
		"env",
		"-i",
		...Object.entries(environment).map(([key, value]) => key + "=" + value),
		process.execPath,
		resolve(root, "tools/admin-emulator.ts"),
		...process.argv.slice(2),
	],
	{
		cwd: root,
		stdout: "inherit",
		stderr: "inherit",
		stdin: "ignore",
		timeout: 60_000,
	},
);
process.exit(await child.exited);
