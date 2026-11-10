import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { CapturedMessage } from "../tools/fake-fcm";

const root = resolve(import.meta.dir, "..");
async function within<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error("Demo deadline exceeded")), milliseconds);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}
test("standalone demo: alternate ports, HTTP enrollment, capture cursor/modes and SIGTERM cleanup", async () => {
	mkdirSync(resolve(root, ".emulator"), { recursive: true });
	const ports = [19671, 19672, 19673, 19674, 19675, 19676, 19677];
	const environment: Record<string, string | undefined> = {
		...process.env,
		GCLOUD_PROJECT: "synthetic-forbidden-project",
		RELAY_DATABASE_ID: "relay-demo-checks",
		GOOGLE_APPLICATION_CREDENTIALS: "/nonexistent-synthetic/adc.json",
	};
	["AUTH", "FIRESTORE", "FUNCTIONS", "HUB", "LOGGING", "WEBSOCKET", "FCM"].forEach((name, index) => {
		environment[`RELAY_${name}_PORT`] = String(ports[index]);
	});
	const child = Bun.spawn([process.execPath, "run", "tools/demo-stack.ts", "--minutes", "2"], {
		cwd: root,
		env: environment,
		stdout: "pipe",
		stderr: Bun.file(resolve(root, ".emulator/demo-smoke.log")),
		stdin: "ignore",
	});
	try {
		const reader = child.stdout.getReader();
		const line = await within(
			(async () => {
				let text = "";
				while (!text.includes("\n")) {
					const { done, value } = await reader.read();
					if (done || text.length > 16384) throw new Error("Missing demo readiness line");
					text += new TextDecoder().decode(value);
				}
				return text.split("\n")[0];
			})(),
			95_000,
		);
		const ready = JSON.parse(line) as {
			pid: number;
			projectId: string;
			databaseId: string;
			functionBaseUrl: string;
			authEmulatorHost: string;
			firestoreHost: string;
			fakeFcmUrl: string;
			captureFile: string;
		};
		expect(ready.pid).toBe(child.pid);
		expect(ready.projectId).toBe("demo-aiki-relay");
		expect(ready.databaseId).toBe("relay-demo-checks");
		expect(ready.functionBaseUrl).toBe("http://127.0.0.1:19673/demo-aiki-relay/us-central1/relay/v1/");
		expect(ready.authEmulatorHost).toBe("127.0.0.1:19671");
		expect(ready.firestoreHost).toBe("127.0.0.1:19672");
		expect(ready.fakeFcmUrl).toBe("http://127.0.0.1:19677");
		expect(ready.captureFile.startsWith(resolve(root, ".emulator/stack-19673") + "/captured-")).toBe(true);
		const auth = async (path: string, body?: unknown) => {
			const response = await fetch(`http://${ready.authEmulatorHost}/${path}`, {
				method: body ? "POST" : "GET",
				headers: { "Content-Type": "application/json" },
				...(body ? { body: JSON.stringify(body) } : {}),
				signal: AbortSignal.timeout(5000),
			});
			expect(response.status).toBe(200);
			return response.json() as Promise<Record<string, unknown>>;
		};
		const email = "synthetic-demo@example.com";
		await auth("identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=synthetic", {
			requestType: "EMAIL_SIGNIN",
			email,
			continueUrl: "https://example.com/finish",
		});
		const codes = await auth("emulator/v1/projects/demo-aiki-relay/oobCodes");
		const oobCode = (codes.oobCodes as { email: string; oobCode: string }[]).find(
			(entry) => entry.email === email,
		)!.oobCode;
		const identity = await auth("identitytoolkit.googleapis.com/v1/accounts:signInWithEmailLink?key=synthetic", {
			email,
			oobCode,
		});
		const api = (path: string, body: unknown) =>
			fetch(ready.functionBaseUrl + path, {
				method: "POST",
				headers: { "Content-Type": "application/octet-stream", Authorization: `Bearer ${identity.idToken}` },
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(10000),
			});
		const installationId = randomBytes(16).toString("base64url");
		const operationId = randomBytes(16).toString("base64url");
		expect(
			(await api("installations/begin", { installationId, operationId, token: "synthetic-demo-phone" })).status,
		).toBe(200);
		const captured = (await (await fetch(ready.fakeFcmUrl + "/captured?after=0")).json()) as {
			messages: CapturedMessage[];
			next: number;
		};
		expect(captured.next).toBe(1);
		expect(captured.messages).toHaveLength(1);
		const message = captured.messages[0];
		expect(message.index).toBe(1);
		expect(message.time).toBeGreaterThan(0);
		expect(message.token).toBe("synthetic-demo-phone");
		expect(message.priority).toBe("normal");
		expect(message.ttlMs).toBeGreaterThan(290000);
		expect(message.ttlMs).toBeLessThanOrEqual(300000);
		expect(JSON.parse((await Bun.file(ready.captureFile).text()).trim())).toEqual(message);
		const challenge = JSON.parse(message.data.aiki) as { challengeId: string; nonce: string };
		const confirm = await api("installations/confirm", {
			installationId,
			operationId,
			challengeId: challenge.challengeId,
			nonce: challenge.nonce,
		});
		expect(confirm.status).toBe(200);
		expect(((await confirm.json()) as { generation: number }).generation).toBe(1);
		// Owner is the Auth/Firestore emulator's synthetic admin marker, never a real credential.
		for (const [databaseId, status] of [
			["relay-demo-checks", 200],
			["(default)", 404],
		] as const) {
			const control = await fetch(
				`http://${ready.firestoreHost}/v1/projects/demo-aiki-relay/databases/${databaseId}/documents/relayControl/settings`,
				{ headers: { Authorization: "Bearer owner" } },
			);
			expect(control.status).toBe(status);
		}
		expect(
			((await (await fetch(ready.fakeFcmUrl + "/captured?after=1")).json()) as { messages: unknown[] }).messages,
		).toEqual([]);
		for (const mode of ["accepted", "unregistered", "rate_limited", "unavailable", "timeout"]) {
			const response = await fetch(ready.fakeFcmUrl + "/mode", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ mode }),
			});
			expect(response.status).toBe(200);
			const sent = await fetch(ready.fakeFcmUrl + "/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					token: "synthetic-mode-probe",
					data: { synthetic: "probe" },
					priority: "high",
					ttlMs: 1000,
				}),
			});
			expect(await sent.text()).toBe(mode);
		}
		const rest = (await (await fetch(ready.fakeFcmUrl + "/captured?after=1")).json()) as {
			messages: CapturedMessage[];
			next: number;
		};
		expect(rest.messages).toHaveLength(5);
		expect(rest.next).toBe(6);
		expect((await fetch(ready.fakeFcmUrl + "/captured?after=-1")).status).toBe(400);
		process.kill(ready.pid, "SIGTERM");
		expect(await within(child.exited, 20_000)).toBe(0);
	} finally {
		if (child.exitCode === null) {
			child.kill("SIGTERM");
			await within(child.exited, 20_000);
		}
	}
	const sockets = Bun.spawnSync(["ss", "-ltn"], { timeout: 5000 });
	expect(sockets.exitCode).toBe(0);
	for (const port of ports) expect(new RegExp(`:${port}\\b`).test(sockets.stdout.toString())).toBe(false);
}, 120_000);

test("standalone demo refuses host/project overrides, invalid durations and occupied ports", async () => {
	for (const args of [
		["--minutes", "0"],
		["--minutes", "121"],
		["--project", "non-demo"],
		["--host", "0.0.0.0"],
	]) {
		const child = Bun.spawn([process.execPath, "run", "tools/demo-stack.ts", ...args], {
			cwd: root,
			stdout: "ignore",
			stderr: "ignore",
			stdin: "ignore",
			timeout: 5000,
		});
		expect(await child.exited).toBe(1);
	}
	const occupied = Bun.serve({ hostname: "127.0.0.1", port: 19677, fetch: () => new Response("synthetic") });
	try {
		const child = Bun.spawn([process.execPath, "run", "tools/demo-stack.ts"], {
			cwd: root,
			env: { ...process.env, RELAY_FCM_PORT: "19677" },
			stdout: "ignore",
			stderr: "pipe",
			stdin: "ignore",
			timeout: 5000,
		});
		expect(await child.exited).toBe(1);
		expect(await new Response(child.stderr).text()).toContain("Emulator port occupied");
	} finally {
		await occupied.stop(true);
	}
});
