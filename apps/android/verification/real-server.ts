/** Actual checkout startServer, with only the model provider replaced. Run via launch-real.ts. */
import { createModels } from "../../../packages/server/node_modules/@earendil-works/pi-ai/dist/index.js";
import {
	fauxProvider,
} from "../../../packages/server/node_modules/@earendil-works/pi-ai/dist/providers/faux.js";
import { startServer } from "../../../packages/server/src/server.ts";
import { FileCredentialStore } from "../../../packages/server/src/credentials.ts";
import { connect } from "./wire.ts";
import { join } from "node:path";
import { copyFile, writeFile } from "node:fs/promises";
import { scenarioResponse } from "./real-scenarios.ts";
import { verifyRealContracts } from "./verify-real-contracts.ts";
const root = process.env.ANDROID_VERIFY_ROOT;
if (!root || process.env.HOME !== join(root, "home"))
	throw new Error("Run launch-real.ts for scratch isolation");
const credentials = new FileCredentialStore(
	join(root, "data", "faux-credentials.json"),
);
const models = createModels({ credentials });
const faux = fauxProvider({
	tokensPerSecond: 10000,
	tokenSize: { min: 3, max: 3 },
});
const longNameModels = faux.provider.getModels().map(model => ({ ...model, name: "Faux verification model with a deliberately long name" }));
models.setProvider(process.env.ANDROID_VERIFY_LONG_MODEL === "1"
    ? { ...faux.provider, getModels: () => longNameModels, getAllModels: () => longNameModels }
    : faux.provider);
// Replenish per request; tool results and prompt identity route concurrent coordinators/workers.
const response: Parameters<typeof faux.setResponses>[0][number] = (request) => {
	faux.appendResponses([response]);
	return scenarioResponse(request, root);
};
faux.setResponses([response]);
// Source media only. Artifact metadata/store writes happen exclusively through actual artifact_save.
for (const [source, target] of [["fixture.png", "proof.png"], ["fixture.mp4", "proof.mp4"]])
	await copyFile(join(import.meta.dir, "media", source!), join(root, "project", target!));
await writeFile(join(root, "project", "proof.bin"), Uint8Array.from({ length: 256 }, (_, i) => i));
const server = await startServer({
	dataDir: join(root, "data"),
	hostname: "127.0.0.1",
	port: Number(process.env.MIHAI_HARNESS_PORT),
	models,
	credentials,
	images: null,
	artifacts: { urlTtlMs: Number(process.env.ARTIFACT_URL_TTL_MS ?? 30000) },
	agentDir: join(root, "agent"),
	configDir: join(root, "config"),
	claudeDir: join(root, "claude"),
	allowedOrigins: [],
	timezone: "UTC",
	status: { deployStatusFile: null },
	notifications: {
		vapidKeyFile: join(root, "data", "vapid.json"),
		subject: "mailto:android-fixture@example.invalid",
		send: async () => ({ status: 201, message: "Scratch push discarded" }),
	},
});
const client = await connect(server.url);
async function request(type: string, fields: Record<string, unknown> = {}) {
	const value = await client.request(type, fields);
	if (value.type === "error")
		throw new Error(`${type}: ${JSON.stringify(value.error)}`);
	return value;
}
let projectId: string;
try {
	const hello = await request("hello", { protocolVersion: 1 });
	if (!hello.features.includes("threads") || !hello.features.includes("artifacts"))
		throw new Error("Real checkout must advertise implemented threads/artifacts");
	const added = await request("projects.add", { path: join(root, "project") });
	projectId = added.project.id;
	await request("projects.configure", {
		projectId,
		name: "Android real checkout (faux model)",
		coordinatorModel: { provider: "faux", modelId: "faux-1" },
		workerModels: [{ provider: "faux", modelId: "faux-1" }],
		checkIns: { enabled: false, intervalMinutes: 10 },
	});
	if (process.argv.includes("--contracts") || process.argv.includes("--seed"))
		await verifyRealContracts(server.url, projectId, root, process.argv.includes("--seed"));
	if (process.argv.includes("--smoke")) {
		for (const type of ["projects.list", "models.list", "subscriptions.usage"])
			await request(type);
		for (const type of [
			"workers.list",
			"board.get",
			"schedules.list",
			"conversation.context",
		])
			await request(type, { projectId });
		await request("memory.list", { scope: "global" });
		await request("memory.list", { scope: "project", projectId });
		await request("conversation.watch", { projectId });
		await request("conversation.submit", {
			projectId,
			requestId: `smoke-${crypto.randomUUID()}`,
			content: "Verify actual streaming on the scratch checkout server",
			whenBusy: "steer",
		});
		const deadline = Date.now() + 10_000;
		let answered = false;
		while (Date.now() < deadline) {
			const page = await request("conversation.page", {
				projectId,
				limit: 1,
				order: "descending",
			});
			if (page.entries[0]?.kind === "pi.assistant") {
				answered = true;
				break;
			}
			await Bun.sleep(50);
		}
		if (!answered) throw new Error("No committed faux answer");
		if (!client.events.some((e) => e.type === "conversation.view"))
			throw new Error("No real Chord pushes");
		console.log(
			"REAL API SMOKE PASS: project/configure/models/chat/stream/workers/board/memory/schedules/usage/context (read APIs; not populated worker/memory/usage scenarios)",
		);
	}
} catch (error) {
	client.close();
	await server.stop();
	throw error;
}
client.close();
console.log(
	`REAL CHECKOUT SERVER ${server.url}; project ${projectId}; data ${server.dataDir}; model faux/faux-1`,
);
if (process.argv.includes("--smoke") || process.argv.includes("--contracts")) {
	await server.stop();
	process.exit(0);
}
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
	process.on(signal, async () => {
		if (stopping) return;
		stopping = true;
		await server.stop();
		process.exit(0);
	});
