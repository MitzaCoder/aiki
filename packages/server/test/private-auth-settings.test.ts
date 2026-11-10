import { afterEach, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { authSecret } from "../src/device-auth.ts";
import { createSetup, type TestSetup } from "./support.ts";

const main = join(import.meta.dir, "../src/main.ts");
const setups: TestSetup[] = [];
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) await cleanup();
	for (const s of setups.splice(0)) await s.cleanup();
});

for (const originSource of ["backend origins", "public URL fallback"] as const) {
	test(`env-file auth settings reach the real server and owner CLI (${originSource})`, async () => {
		const s = await createSetup({ terminals: false });
		setups.push(s);
		const file = join(s.root, "isolated-server.env");
		const backend = originSource === "backend origins" ? "https://backend.example.test" : "https://fallback.example.test";
		await writeFile(file, [
			`AIKI_DATA_DIR=${JSON.stringify(join(s.root, "isolated-data"))}`,
			`AIKI_CONFIG_DIR=${JSON.stringify(s.configDir)}`,
			`AIKI_AGENT_DIR=${JSON.stringify(s.agentDir)}`,
			`AIKI_CLAUDE_DIR=${JSON.stringify(s.claudeDir)}`,
			"AIKI_HOST=127.0.0.1", "AIKI_PORT=0", "AIKI_AUTH_MODE=required", "AIKI_TERMINALS=off",
			"AIKI_ALLOWED_ORIGINS=https://browser.example.test", "AIKI_TRUSTED_PROXIES=127.0.0.1",
			"AIKI_WEB_APP=https://web.example.test", "AIKI_PUBLIC_URL=https://fallback.example.test/legacy-path",
			...(originSource === "backend origins" ? ["AIKI_BACKEND_ORIGINS=https://backend.example.test"] : []),
		].join("\n"), { mode: 0o600 });
		// Explicit minimal environment and temp paths: never reuse the harness's real installation settings.
		const env = { PATH: process.env.PATH, HOME: s.root, AIKI_ENV_FILE: file };
		const child = Bun.spawn([process.execPath, main], { env, stdout: "pipe", stderr: "pipe" });
		const ready = Promise.withResolvers<string>();
		let logs = "";
		let errors = "";
		const output = (async () => {
			for await (const bytes of child.stdout) {
				logs += new TextDecoder().decode(bytes);
				const match = /Aiki listening on (http:\/\/[^\s]+)/.exec(logs);
				if (match) ready.resolve(match[1]!);
			}
		})();
		const errorOutput = (async () => { for await (const bytes of child.stderr) errors += new TextDecoder().decode(bytes); })();
		void child.exited.then(code => ready.reject(new Error(`Isolated server exited (${code}): ${errors}`)));
		const timeout = setTimeout(() => ready.reject(new Error(`Isolated startup timed out: ${logs}\n${errors}`)), 5000);
		cleanups.push(async () => {
			clearTimeout(timeout);
			child.kill("SIGTERM");
			await child.exited;
			await Promise.all([output, errorOutput]);
			// Keep the first real entry-point startup log in the retained test-run log, not just the deleted temp fixture.
			console.info(`Synthetic ${originSource} entry-point log:\n${logs}${errors}`);
		});
		const url = await ready.promise;
		clearTimeout(timeout);
		const run = async (args: string[]) => {
			const cli = Bun.spawn([process.execPath, main, "auth", ...args], { env: { ...env, AIKI_CHILD_PROCESS: "1" }, stdout: "pipe", stderr: "pipe", timeout: 5000 });
			const [code, stdout, stderr] = await Promise.all([cli.exited, new Response(cli.stdout).text(), new Response(cli.stderr).text()]);
			expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
			return JSON.parse(stdout);
		};
		expect(await run(["status"])).toMatchObject({ mode: "required" });
		expect(await run(["hosts", "list"])).toMatchObject({ allowed: [backend] });
		const pairing = await run(["pair", "--backend", backend]);
		expect(pairing.url).toStartWith("https://web.example.test/pair#bootstrap=");
		// A loopback peer is trusted only because the env-file setting reached server.ts.
		const forwarded = await fetch(`${url}/auth/status`, { headers: {
			host: "unapproved.example.test", "x-forwarded-host": new URL(backend).host, "x-forwarded-proto": "https",
		} });
		expect(forwarded.status).toBe(200);
		expect(await forwarded.json()).toMatchObject({ mode: "required" });
		const localPairing = await run(["pair", "--local"]);
		const localCode = new URLSearchParams(new URL(localPairing.url).hash.slice(1)).get("bootstrap")!;
		const local = await fetch(`${url}/auth/bootstrap/redeem`, {
			method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
				requestId: "local", code: localCode, claimId: randomBytes(16).toString("hex"),
				claimSecret: authSecret("aiki_c1"), label: "Synthetic local browser", platform: "web",
			}),
		});
		expect(local.status).toBe(401); // Trusted proxy peers cannot use local bootstrap, even without forwarding headers.
	}, 15000);
}
