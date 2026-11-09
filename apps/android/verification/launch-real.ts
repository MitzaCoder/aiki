/** Starts ONLY a scratch child with a clean environment; never production storage or model credentials. */
import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
const scratch = join(homedir(), "scratch");
await mkdir(scratch, { recursive: true });
const normal = process.argv.includes("--normal");
if (normal && process.argv.some((arg) => ["--seed", "--contracts", "--smoke"].includes(arg)))
	throw new Error("--normal cannot run faux-model scenarios");
const root = process.argv.includes("--smoke") || process.argv.includes("--contracts") || process.argv.includes("--seed") || process.argv.includes("--fresh")
	? await mkdtemp(join(scratch, "android-verification-real-smoke-"))
	: join(
			scratch,
			normal ? "android-verification-normal" : "android-verification-real",
		);
for (const dir of [
	root,
	...[
		"home",
		"tmp",
		"cache",
		"config",
		"agent",
		"claude",
		"data",
		"project",
	].map((d) => join(root, d)),
]) {
	await mkdir(dir, { recursive: true });
	if (!(await realpath(dir)).startsWith(`${await realpath(scratch)}/`))
		throw new Error("Refusing scratch symlink outside scratch");
}
const env = {
	PATH: process.env.PATH ?? "",
	HOME: join(root, "home"),
	TMPDIR: join(root, "tmp"),
	XDG_CACHE_HOME: join(root, "cache"),
	XDG_CONFIG_HOME: join(root, "config"),
	BUN_INSTALL_CACHE_DIR: join(root, "cache", "bun"),
	MIHAI_HARNESS_DATA_DIR: join(root, "data"),
	MIHAI_HARNESS_AGENT_DIR: join(root, "agent"),
	MIHAI_HARNESS_CONFIG_DIR: join(root, "config"),
	MIHAI_HARNESS_CLAUDE_DIR: join(root, "claude"),
	MIHAI_HARNESS_VAPID_KEY_FILE: join(root, "data", "vapid.json"),
	MIHAI_HARNESS_VAPID_SUBJECT: "mailto:android-fixture@example.invalid",
	MIHAI_HARNESS_HOST: "127.0.0.1",
	MIHAI_HARNESS_PORT: process.env.PORT ?? "4789",
	ARTIFACT_URL_TTL_MS: process.env.ARTIFACT_URL_TTL_MS ?? (process.argv.includes("--contracts") ? "2000" : "30000"),
	MIHAI_HARNESS_TIMEZONE: "UTC",
	ANDROID_VERIFY_ROOT: root,
	ANDROID_VERIFY_LONG_MODEL: process.env.ANDROID_VERIFY_LONG_MODEL ?? "",
};
console.log(
	`REAL CHECKOUT SERVER (${normal ? "normal main.ts, no injected model" : "injected faux model, no credentials"}); root ${root}; port ${env.MIHAI_HARNESS_PORT}`,
);
const entry = normal
	? "../../../packages/server/src/main.ts"
	: "./real-server.ts";
const child = Bun.spawn(
	[
		process.execPath,
		"run",
		resolve(import.meta.dir, entry),
		...process.argv.slice(2).filter((arg) => ["--smoke", "--contracts", "--seed"].includes(arg)),

	],
	{
		env,
		cwd: join(root, "project"),
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	},
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
	process.on(signal, () => child.kill(signal));
process.exit(await child.exited);
