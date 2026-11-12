/** Test-only executable, never released: real coordinator/tools with a deterministic local model. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { applyImmutable, type Op } from "@earendil-works/chord/delta";
import { createModels } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { ConversationView, ServerMessage } from "@aiki/protocol";
import { loadServerEnv, resolvedServerConfig } from "../src/server-env.ts";
import { configureServerSettings } from "../src/server-settings.ts";
import { packagedResources } from "../src/packaged-resources.ts";
import { createCodemodeSandbox } from "../src/codemode.ts";
import { createPackagedPhotonImages } from "../src/binary-images.ts";
import { syntheticPdf } from "./pdf-fixture.ts";

const deadline = setTimeout(() => { console.error("Binary smoke deadline exceeded"); process.exit(1); }, 60_000);
configureServerSettings(loadServerEnv());
const config = resolvedServerConfig();
console.log(`Smoke PID: ${process.pid}\nSmoke paths: ${JSON.stringify(config)}`);
assert.equal(Bun.which("bun"), null, "Bun must not be on the runtime PATH");
const { FileCredentialStore } = await import("../src/credentials.ts");
const { startServer } = await import("../src/server.ts");
const projectDir = join(config.dataDir, "synthetic-project");
await mkdir(projectDir, { recursive: true });
await writeFile(join(projectDir, "README.md"), "# binary smoke fixture\n");
const credentials = new FileCredentialStore(join(config.dataDir, "credentials.json"));
const models = createModels({ credentials });
const faux = fauxProvider();
models.setProvider(faux.provider);
faux.setResponses(Array.from({ length: 40 }, () => request => {
	const last = request.messages.findLast(message => message.role !== "system");
	const text = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content);
	if (last?.role === "toolResult") return fauxAssistantMessage("Tool finished.");
	if (text?.includes("CODEMODE_PROBE")) return fauxAssistantMessage([
		fauxToolCall("codemode", { code: 'const readme = await tools.read({path:"README.md"}); return {readme, sum:6*7};' }),
	], { stopReason: "toolUse" });
	if (text?.includes("WORKER_PROBE")) return fauxAssistantMessage([
		fauxToolCall("worker_spawn", { id: "reader", title: "Read synthetic fixture", task: "Read the synthetic fixture and report BINARY_WORKER_DONE.", isolation: "shared" }),
	], { stopReason: "toolUse" });
	if (text?.includes("Read the synthetic fixture")) return fauxAssistantMessage("## Report\nOutcome: done BINARY_WORKER_DONE\nFiles changed: none");
	return fauxAssistantMessage("Coordinator turn complete.");
}));
const server = await startServer({
	dataDir: config.dataDir, configDir: config.configDir, agentDir: config.agentDir, claudeDir: config.claudeDir,
	hostname: "127.0.0.1", port: 0, models, credentials, webDir: "embedded", auth: { mode: "off" },
	terminals: false, notifications: { fcmKeyFile: null, relayEndpoint: null },
});
const socket = new WebSocket(server.url.replace("http", "ws") + "/ws");
const pending = new Map<string, (message: ServerMessage) => void>();
let sequence = 0;
let view: ConversationView | undefined;
const changes = new Set<() => void>();
socket.addEventListener("message", event => {
	const message = JSON.parse(String(event.data)) as ServerMessage;
	if (message.type === "conversation.view" && view) view = applyImmutable(view as never, message.ops as unknown as Op[]) as unknown as ConversationView;
	const id = (message as { id?: string }).id;
	if (id) pending.get(id)?.(message);
	for (const changed of changes) changed();
});
await new Promise<void>((resolve, reject) => {
	socket.addEventListener("open", () => resolve(), { once: true });
	socket.addEventListener("error", () => reject(new Error("WebSocket failed")), { once: true });
});
async function rpc(message: Record<string, unknown>): Promise<any> {
	const id = `smoke-${++sequence}`;
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`RPC timeout: ${message.type}`)), 15_000);
		pending.set(id, response => {
			clearTimeout(timer); pending.delete(id);
			if (response.type === "error") reject(new Error(JSON.stringify(response)));
			else resolve(response);
		});
		socket.send(JSON.stringify({ ...message, id }));
	});
}
async function waitForView(predicate: (text: string) => boolean): Promise<void> {
	if (predicate(JSON.stringify(view))) return;
	await new Promise<void>((resolve, reject) => {
		const changed = () => {
			if (!predicate(JSON.stringify(view))) return;
			clearTimeout(timer); changes.delete(changed); resolve();
		};
		const timer = setTimeout(() => { changes.delete(changed); reject(new Error("Transcript timeout")); }, 20_000);
		changes.add(changed);
	});
}

try {
	assert.equal((await rpc({ type: "hello", protocolVersion: 1 })).type, "hello");
	const status = await rpc({ type: "server.status" });
	assert.equal(status.status.release.name, packagedResources.release?.name);
	const { project } = await rpc({ type: "projects.add", path: projectDir });
	const model = { provider: "faux", modelId: "faux-1" };
	await rpc({ type: "projects.configure", projectId: project.id, coordinatorModel: model, workerModels: [model] });
	view = (await rpc({ type: "conversation.watch", projectId: project.id })).view;
	const upload = await fetch(`${server.url}/attachments/${project.id}?name=smoke.pdf`, { method: "POST", headers: { "content-type": "application/pdf" }, body: syntheticPdf(["BINARY_PDF_TEXT_PROBE"]) as BodyInit });
	assert.equal(upload.status, 200);
	const pdfFile = await upload.json() as { id: string };
	await rpc({ type: "conversation.submit", projectId: project.id, requestId: "pdf", content: "Review the PDF", fileIds: [pdfFile.id] });
	await waitForView(text => text.includes("BINARY_PDF_TEXT_PROBE") && text.includes("text extracted; the original is at"));
	console.log("PASS: compiled PDF upload, page count and bounded text fallback");
	await rpc({ type: "conversation.submit", projectId: project.id, requestId: "code", content: "CODEMODE_PROBE" });
	await waitForView(text => text.includes("Script completed") && text.includes("binary smoke fixture") && text.includes("42"));
	await rpc({ type: "conversation.submit", projectId: project.id, requestId: "worker", content: "WORKER_PROBE" });
	await waitForView(text => text.includes("[worker reader reported]") && text.includes("BINARY_WORKER_DONE"));
	const { workers } = await rpc({ type: "workers.list", projectId: project.id });
	assert.equal(workers[0].failure, null);
	assert.match(workers[0].lastReport, /Outcome: done/);
	const sandbox = createCodemodeSandbox();
	try {
		const runaway = await sandbox.execute("while (true) {}", { timeoutMs: 100 });
		assert.equal(runaway.ok, false);
		const next = await sandbox.execute("return 42", { timeoutMs: 5000 });
		assert.equal(next.ok && next.value, 42, JSON.stringify(next));
	} finally { await sandbox.close(); }
	const restartedSandbox = createCodemodeSandbox();
	try { assert.equal((await restartedSandbox.execute("return 43")).ok, true); }
	finally { await restartedSandbox.close(); }
	// A synthetic 4x4 24-bit BMP forces real decode, scaling and PNG encoding in the image thread.
	const bmp = Buffer.alloc(102, 0xff);
	bmp.fill(0, 0, 54); bmp.write("BM"); bmp.writeUInt32LE(102, 2); bmp.writeUInt32LE(54, 10);
	bmp.writeUInt32LE(40, 14); bmp.writeInt32LE(4, 18); bmp.writeInt32LE(4, 22);
	bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28); bmp.writeUInt32LE(48, 34);
	const prepared = await createPackagedPhotonImages().prepare(bmp, "image/bmp", { maxWidth: 2, maxHeight: 2, maxBytes: 10000 });
	assert.equal(prepared?.mimeType, "image/png");
	assert.deepEqual(prepared?.resized?.to, { width: 2, height: 2 });
	console.log("PASS: coordinator, codemode tool/read, worker report, QuickJS timeout/recovery/recreation, Photon thread decode/resize");
} finally {
	socket.close();
	await server.stop();
	clearTimeout(deadline);
}
