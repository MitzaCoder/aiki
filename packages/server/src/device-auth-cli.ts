/** Owner-only local control; the service never logs command payloads or bootstrap output. */
import { chmodSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DeviceAuth, DeviceAuthError, validateBackendOrigin } from "./device-auth.ts";
import { authFailure, authJson, readAuthBody } from "./device-auth-http.ts";
import { resolveDataDir } from "./data-dir.ts";

export async function startAuthControl(
	auth: DeviceAuth,
	options: { loopbackOrigin: string; allowedOrigins: readonly string[] },
): Promise<() => void> {
	const socket = join(auth.dir, "auth.sock");
	if (existsSync(socket)) {
		let active = false;
		try {
			await fetch("http://localhost/", { unix: socket, signal: AbortSignal.timeout(500) });
			active = true;
		} catch {}
		if (active) throw new Error("Owner control socket already in use");
		unlinkSync(socket);
	}
	const server = Bun.serve({
		unix: socket,
		async fetch(request) {
			try {
				if (request.method !== "POST") return authJson({}, 405);
				const body = await readAuthBody(request);
				if (!Array.isArray(body.args) || !body.args.every((x) => typeof x === "string"))
					throw new DeviceAuthError("bad_request", 400);
				return authJson(await ownerCommand(auth, body.args as string[], options));
			} catch (error) {
				return authFailure(error);
			}
		},
	});
	chmodSync(socket, 0o600);
	return () => {
		server.stop(true);
		if (existsSync(socket)) unlinkSync(socket);
	};
}
export async function ownerCommand(
	auth: DeviceAuth,
	args: string[],
	options: { loopbackOrigin: string; allowedOrigins: readonly string[] },
): Promise<unknown> {
	const [command, action, value, ...rest] = args;
	const flag = (name: string) => {
		const i = args.indexOf(name);
		return i < 0 ? undefined : args[i + 1];
	};
	switch (command) {
		case "status":
			return auth.status();
		case "mode":
			return auth.setMode(action);
		case "devices":
			if (action === "list") return { devices: auth.devices() };
			if (action === "revoke" && value) {
				await auth.revoke(value);
				return { ok: true };
			}
			break;
		case "revoke-all":
			for (const device of auth.devices()) await auth.revoke(device.id);
			return { ok: true };
		case "hosts":
			if (action === "list") return auth.hostsList();
			if (value && (action === "allow" || action === "remove")) return auth.hostChange(value, action === "allow");
			break;
		case "migration":
			if (action === "list") return { claims: auth.inventory() };
			if (action === "approve" && value === "--batch" && rest[0] && rest.length > 1)
				return auth.approveMigration(rest[0], rest.slice(1));
			break;
		case "pair": {
			const local = args.includes("--local");
			const backend = local ? options.loopbackOrigin : flag("--backend");
			if (!backend || (!local && !auth.hosts.includes(validateBackendOrigin(backend))))
				throw new DeviceAuthError("backend_origin_required", 400);
			const webApp = flag("--web-app") ?? process.env.AIKI_WEB_APP ?? options.allowedOrigins[0];
			if (!local && !webApp) throw new DeviceAuthError("web_app_required", 400);
			if (webApp) validateBackendOrigin(webApp);
			const grant = auth.bootstrap(local);
			if (local) return { url: `${options.loopbackOrigin}/pair#bootstrap=${grant.secret}`, expiresAt: grant.expiresAt };
			const fragment = Buffer.from(JSON.stringify([auth.backendId, backend, grant.requestId])).toString("base64url");
			return { url: `${webApp}/pair#bootstrap=v1.${fragment}`, code: grant.secret, expiresAt: grant.expiresAt };
		}
	}
	throw new DeviceAuthError("invalid_command", 400);
}
export async function runAuthCli(args: string[]): Promise<void> {
	try {
		const response = await fetch("http://localhost/", {
			unix: join(resolveDataDir(), "auth.sock"),
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ args }),
			signal: AbortSignal.timeout(10000),
		});
		const result = await response.json();
		if (!response.ok) {
			console.error("Auth command failed", (result as { error: { code: string } }).error.code);
			process.exitCode = 1;
			return;
		}
		console.log(JSON.stringify(result, null, 2));
	} catch {
		console.error("Cannot reach running backend owner socket");
		process.exitCode = 1;
	}
}
