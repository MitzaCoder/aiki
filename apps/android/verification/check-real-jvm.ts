/** Reusable live native DATA/transport test (no emulator). Owns and always stops its port-0 scratch server. */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
const cache = join(homedir(), "scratch", "android-cache");
await mkdir(cache, { recursive: true });
const logs = await mkdtemp(join(cache, "r2-real-jvm-"));
const server = Bun.spawn([process.execPath, "run", join(import.meta.dir, "launch-real.ts"), "--seed"], {
	env: { ...process.env, PORT: "0", ARTIFACT_URL_TTL_MS: "2000" },
	stdout: "pipe", stderr: "pipe",
});
let stdout = "";
let stderr = "";
const pump = async (stream: ReadableStream<Uint8Array>, append: (value: string) => void) => {
	const decoder = new TextDecoder();
	for await (const chunk of stream) append(decoder.decode(chunk, { stream: true }));
};
const reads = [pump(server.stdout, (v) => { stdout += v; }), pump(server.stderr, (v) => { stderr += v; })];
let gradle: ReturnType<typeof Bun.spawn> | undefined;
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => { server.kill(signal); gradle?.kill(signal); });
try {
	const deadline = Date.now() + 45000;
	let origin: string | undefined;
	while (!origin && Date.now() < deadline) {
		origin = /REAL CHECKOUT SERVER (http:\/\/127\.0\.0\.1:\d+);/.exec(stdout)?.[1];
		if (server.exitCode !== null) throw new Error(`Seed server exited ${server.exitCode}`);
		if (!origin) await Bun.sleep(50);
	}
	if (!origin) throw new Error("Seed server did not become ready");
	console.log(`Live native data contract on ${origin}; Gradle log ${join(logs, "gradle.log")}`);
	const tasks = process.argv.includes("--all")
		? [":app:testDebugUnitTest", ":app:lintDebug", ":app:assembleDebug"]
		: [":app:testDebugUnitTest", "--tests", "com.mihaisaru.harness.RealServerContractTest"];
	// build.sh takes this checkout's build lock itself.
	gradle = Bun.spawn([resolve(import.meta.dir, "../scripts/build.sh"), ...tasks, "--rerun-tasks"], {
		env: { ...process.env, ANDROID_REAL_CONTRACT_ORIGIN: origin },
		stdout: Bun.file(join(logs, "gradle.log")), stderr: Bun.file(join(logs, "gradle-error.log")),
	});
	const result = await gradle.exited;
	if (result !== 0) throw new Error(`Native data contract failed (${result}); inspect ${join(logs, "gradle.log")}`);
	console.log("REAL JVM CONTRACT PASS (actual native socket/DTO/Chord/scoped submit/signed HTTP)");
} finally {
	server.kill("SIGTERM");
	await server.exited;
	await Promise.all(reads);
	await writeFile(join(logs, "server.log"), stdout + stderr);
	console.log(`Scratch logs ${logs}`);
}
