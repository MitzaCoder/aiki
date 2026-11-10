/** Isolated browser fixture. Run with Bun, then stop it by its printed PID. Never uses host data or VAPID files. */
import { authSecret } from "../../../packages/server/src/device-auth.ts";
import { createSetup } from "../../../packages/server/test/support.ts";
import { readFile } from "node:fs/promises";
import { createVapidKeys } from "../../../packages/server/src/notifications.ts";
import { serveWeb } from "../../../packages/server/src/static-web.ts";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = await mkdtemp(join(tmpdir(), "aiki-push-browser-"));
const origin = "http://127.0.0.1:4198";
const keys = [await createVapidKeys(), await createVapidKeys()];
const files = [join(root, "alpha.json"), join(root, "beta.json")];
await Promise.all(files.map((file, i) => writeFile(file, JSON.stringify(keys[i]), { mode: 0o600 })));
const setups = [];
for (const index of [0, 1, 0, 0, 0, 0]) {
	setups.push(
		await createSetup({
			auth: { mode: "required" },
			terminals: false,
			allowedOrigins: [origin],
			notifications: { vapidKeyFile: files[index]!, subject: "https://app.example.test", fcmKeyFile: null },
		}),
	);
}
const configuredBackends = setups.map((setup, i) => ({
	id: ["alpha", "beta", "gamma", "operator-a", "operator-b", "operator-c"][i],
	name: ["Alpha", "Beta", "Gamma", "Operator A", "Operator B", "Operator C"][i],
	url: setup.server.url,
}));
const backends = configuredBackends.slice(0, 3);
const credentials = await Promise.all(
	setups.map(async (setup, i) => {
		const grant = setup.server.auth.bootstrap();
		const result = await setup.server.auth.redeem(
			{
				grantId: grant.requestId,
				secret: grant.secret,
				claimId: crypto.randomUUID(),
				claimSecret: authSecret("aiki_c1"),
				label: "Synthetic browser",
				platform: "web",
			},
			"loopback",
			true,
		);
		const session = result.credentials!;
		return {
			backendId: session.backendId,
			origin: setup.server.url,
			advertised: true,
			session: {
				sessionId: session.sessionId,
				sessionToken: session.sessionToken,
				sessionExpiresAt: session.sessionExpiresAt,
				rotateAfter: session.rotateAfter,
			},
		};
	}),
);
const pushes: { endpoint: string; publicKey: string | null }[] = [];
const push = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch(request) {
		pushes.push({
			endpoint: request.url,
			publicKey: /(?:^|,\s*)k=([^,\s]+)/.exec(request.headers.get("authorization") ?? "")?.[1] ?? null,
		});
		return new Response(null, { status: 201 });
	},
});
const ecdh = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const p256dh = Buffer.from(await crypto.subtle.exportKey("raw", ecdh.publicKey)).toString("base64url");
const fixture = {
	origin,
	backends,
	credentials,
	operatorBackends: configuredBackends.slice(3),
	publicKeys: [keys[0]!.publicKey, keys[1]!.publicKey, keys[0]!.publicKey],
	pushOrigin: push.url.origin,
	subscriptionKeys: { p256dh, auth: Buffer.alloc(16, 7).toString("base64url") },
};
const webDirectory = resolve(process.argv[2] ?? "apps/web/build");
const web = Bun.serve({
	hostname: "127.0.0.1",
	port: 4198,
	async fetch(request) {
		const path = new URL(request.url).pathname;
		if (path === "/fixture.json") return Response.json(fixture, { headers: { "cache-control": "no-store" } });
		if (path === "/fixture-blank")
			return new Response("<!doctype html><title>Push fixture</title>", { headers: { "content-type": "text/html" } });
		if (path === "/pushes.json") return Response.json(pushes);
		if (path === "/aiki-local.json") return new Response(null, { status: 404 });
		if (path === "/registrations.json")
			return Response.json(
				await Promise.all(
					setups.map(async (setup) =>
						JSON.parse(
							await readFile(join(setup.dataDir, "notifications", "devices.json"), "utf8").catch(
								() => '{"devices":[]}',
							),
						),
					),
				),
			);
		return serveWeb(request, webDirectory);
	},
});
console.log(JSON.stringify({ pid: process.pid, root, origin, backends }));
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
	process.on(signal, async () => {
		if (stopping) return;
		stopping = true;
		web.stop(true);
		push.stop(true);
		await Promise.all(setups.map((setup) => setup.cleanup()));
		await rm(root, { recursive: true, force: true });
		process.exit(0);
	});
