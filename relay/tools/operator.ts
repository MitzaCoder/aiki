import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { operatorArguments, operatorPlan, OperatorArgumentsError, type OperatorArguments } from "./operator-arguments";
import { emulatorPorts, relayRoot } from "./emulator-launch";
import { RelayError } from "../src/validation";
import type { Dependencies } from "../src/ports";

async function apply(args: OperatorArguments): Promise<void> {
	// Dynamic imports are intentional: a dry run never initializes an SDK or looks for ADC.
	const { initializeApp, applicationDefault, deleteApp } = await import("firebase-admin/app");
	const { getFirestore } = await import("firebase-admin/firestore");
	const { getAuth } = await import("firebase-admin/auth");
	const { createStore } = await import("../src/documents");
	const {
		disableAccount,
		enableAccount,
		eraseAccount,
		disablePhone,
		seedRelayControl,
		setRelayControl,
		operatorStatus,
	} = await import("../src/operator");
	const { reconcileRelay } = await import("../src/reconciliation");
	const app = initializeApp({
		projectId: args.projectId,
		...(!args.emulator ? { credential: applicationDefault() } : {}),
	});
	const firestore = getFirestore(app, args.databaseId);
	const deps: Dependencies = {
		firestore,
		auth: getAuth(app),
		projectId: args.projectId,
		now: Date.now,
		random: (bytes) => randomBytes(bytes).toString("base64url"),
		send: async () => {
			throw new Error("Operator never sends FCM");
		},
		verifyAppCheck: async () => false,
		monitor() {},
	};
	try {
		const command = args.command;
		let complete = true;
		switch (command.action) {
			case "status":
				console.log(JSON.stringify({ status: await operatorStatus(deps) }));
				return;
			case "seed-control":
				await seedRelayControl(deps);
				break;
			case "pause":
				await setRelayControl(deps, { enabled: false });
				break;
			case "resume":
				await setRelayControl(deps, { enabled: true });
				break;
			case "enrollment":
				await setRelayControl(deps, { enrollmentEnabled: command.open });
				break;
			case "limits":
				await setRelayControl(deps, { limits: { [command.name]: command.value } });
				break;
			case "account":
				if (command.operation === "disable") complete = await disableAccount(deps, command.uid);
				else if (command.operation === "delete") complete = await eraseAccount(deps, command.uid);
				else await enableAccount(deps, command.uid);
				break;
			case "phone": {
				const installation = (await createStore(firestore).installations.doc(command.installationId).get()).data();
				if (!installation) throw new RelayError(404, "not_found");
				await disablePhone(deps, installation.uid, command.installationId);
				break;
			}
			case "reconcile":
				await reconcileRelay(deps);
				break;
		}
		console.log(JSON.stringify({ changed: true, complete, ...(!complete ? { retryAfterSeconds: 60 } : {}) }));
	} finally {
		await firestore.terminate();
		await deleteApp(app);
	}
}

async function main() {
	const args = operatorArguments(process.argv.slice(2), process.env);
	if (args.yes && args.emulator) {
		const ports = emulatorPorts();
		const state = resolve(relayRoot, `.emulator/operator-${ports.auth}-${ports.firestore}`);
		if (process.env.RELAY_OPERATOR_INTERNAL !== "1") {
			for (const name of ["home", "config", "cache"]) mkdirSync(resolve(state, name), { recursive: true, mode: 0o700 });
			const environment: Record<string, string> = {
				PATH: process.env.PATH!,
				HOME: resolve(state, "home"),
				XDG_CONFIG_HOME: resolve(state, "config"),
				XDG_CACHE_HOME: resolve(state, "cache"),
				GCLOUD_PROJECT: args.projectId,
				METADATA_SERVER_DETECTION: "none",
				FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${ports.auth}`,
				FIRESTORE_EMULATOR_HOST: `127.0.0.1:${ports.firestore}`,
				RELAY_OPERATOR_INTERNAL: "1",
			};
			for (const [key, value] of Object.entries(ports)) environment[`RELAY_${key.toUpperCase()}_PORT`] = String(value);
			const child = Bun.spawn(
				[
					"env",
					"-i",
					...Object.entries(environment).map(([key, value]) => `${key}=${value}`),
					process.execPath,
					"--no-env-file",
					resolve(import.meta.dir, "operator.ts"),
					...process.argv.slice(2),
				],
				{
					cwd: relayRoot,
					stdout: "inherit",
					stderr: "inherit",
					stdin: "ignore",
					timeout: 60_000,
				},
			);
			for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.once(signal, () => child.kill("SIGTERM"));
			process.exitCode = await child.exited;
			return;
		}
		if (
			process.env.HOME !== resolve(state, "home") ||
			process.env.GCLOUD_PROJECT !== args.projectId ||
			process.env.FIREBASE_AUTH_EMULATOR_HOST !== `127.0.0.1:${ports.auth}` ||
			process.env.FIRESTORE_EMULATOR_HOST !== `127.0.0.1:${ports.firestore}` ||
			["GOOGLE_APPLICATION_CREDENTIALS", "CLOUDSDK_CONFIG", "FIREBASE_TOKEN"].some(
				(name) => process.env[name] !== undefined,
			)
		) {
			throw new Error("Scrubbed loopback operator launcher required");
		}
	}
	console.log(JSON.stringify(operatorPlan(args)));
	if (!args.yes) {
		console.log("Dry run only; pass --yes to perform this operation (including status reads).");
		return;
	}
	await apply(args);
}
try {
	await main();
} catch (error) {
	console.error(
		JSON.stringify({
			error:
				error instanceof RelayError
					? error.code
					: error instanceof OperatorArgumentsError
						? error.message
						: "operator_failed",
			hint: "See relay/DEPLOY.md; choose explicit mode and pass --yes to act.",
		}),
	);
	process.exitCode = 1;
}
