/** A deterministic MODEL, not a service fixture: every returned call runs the checkout's real tool. */
import type { TranscriptContext } from "../../../packages/server/node_modules/@earendil-works/pi-ai/dist/index.js";
import { fauxAssistantMessage, fauxToolCall } from "../../../packages/server/node_modules/@earendil-works/pi-ai/dist/providers/faux.js";
import { join } from "node:path";
import { visualScenario } from "./round2-visual-scenarios.ts";

export const PROOF_THREAD = "contract-proof";
export const TASK_TITLE = 'Contract "evidence" \\ trail\nnotes';
export const FINISH_SUMMARY = "Real tools saved text, image, video and file evidence for T1.";
export const SOURCE_TEXT = "# Real thread evidence\n\nWritten by the actual write tool, saved by artifact_save.\n";
export function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((part) => part?.type === "text" ? part.text ?? "" : "").join("");
}
const call = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
	fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
const say = fauxAssistantMessage;

export function scenarioResponse(request: TranscriptContext, root: string) {
	const visual = visualScenario(request, root);
	if (visual) return visual;
	const system = request.messages.filter((m) => m.role === "system").map((m) => {
		const sections = (m as { sections?: Record<string, string> }).sections;
		return sections ? Object.values(sections).join("\n") : contentText((m as any).content);
	}).join("\n");
	const thread = /You are the background thread "([^"]+)"/.exec(system)?.[1];
	const worker = system.includes('You are the worker "');
	const messages = request.messages.filter((m) => m.role !== "system") as any[];
	const last = messages.at(-1);
	const text = contentText(last?.content);
	const tool = last?.role === "toolResult" ? last.toolName : undefined;
	const inputIndex = messages.findLastIndex((m) => m.role === "user");
	const input = contentText(messages[inputIndex]?.content);
	const project = join(root, "project");
	if (worker) {
		if (!tool) return call("write", { path: "worker-report.txt", content: "Actual background worker evidence.\n" });
		if (tool === "write") return call("artifact_save", { path: "worker-report.txt", title: "Worker evidence", taskId: "T1" });
		return say("## Report\nOutcome: done\nSaved actual worker evidence for T1.");
	}
	if (thread === "failure-proof") return say("", { stopReason: "error", errorMessage: "Deterministic verification model failure [not a server fixture]" });
	if (thread) {
		if (input === "R2 background kickoff") {
			// thread_start already claimed T1 for this thread.
			if (!tool) return call("thread_send", { id: "main", message: "Background owns T1 and is preparing real artifacts.", reply: true });
			if (tool === "thread_send") return call("write", { path: "report.md", content: SOURCE_TEXT });
			const saved = messages.slice(inputIndex + 1).flatMap((m) => Array.isArray(m.content) ? m.content : []).filter((b) => b.type === "toolCall" && b.name === "artifact_save").length;
			const sources = ["report.md", join(project, "proof.png"), join(project, "proof.mp4"), join(project, "proof.bin")];
			if (saved < sources.length) return call("artifact_save", { path: sources[saved], title: ["Tool-written report", "Real saved image", "Real saved video", "Real saved file"][saved], taskId: "T1", note: "Actual checkout tool execution; deterministic faux model." });
			return say("Evidence saved. Waiting for R2 scoped, R2 worker, R2 handoff or R2 finish.");
		}
		if (input === "R2 worker" && !tool) return call("worker_spawn", { id: "proof-worker", task: "Save actual worker evidence for T1.", isolation: "shared" });
		if (input === "R2 handoff" && !tool) return call("board", { action: "handoff", id: "T1", expectedRevision: 2, toThread: "main" });
		if (input === "R2 finish" && !tool) return call("thread_finish", { summary: FINISH_SUMMARY });
		if (input === "R2 late") {
			if (!tool) return call("write", { path: "late.txt", content: "Saved after the first finish; not in its historical strip.\n" });
			if (tool === "write") return call("artifact_save", { path: "late.txt", title: "Later evidence", taskId: "T1" });
		}
		return say(tool ? `Real ${tool} completed.` : `Background received: ${text}`);
	}
	if (input === "R2 start") {
		if (!tool) return call("board", { action: "add_task", title: TASK_TITLE, description: "Tool-driven real background proof" });
		if (tool === "board") return call("thread_start", { title: "Contract proof", brief: "R2 background kickoff", onFinish: "review", taskId: "T1" });
	}
	if (input === "R2 return" && !tool) return call("board", { action: "handoff", id: "T1", expectedRevision: 3, toThread: PROOF_THREAD });
	if (input === "R2 bad message" && !tool) return call("thread_send", { id: "missing-real-thread", message: "Do not create a success card" });
	if (input === "R2 bad save" && !tool) return call("artifact_save", { path: "missing-real-file.txt", title: "Must not create preview" });
	if (input === "R2 main save") {
		if (!tool) return call("write", { path: "main-report.md", content: "Actual main coordinator evidence.\n" });
		if (tool === "write") return call("artifact_save", { path: "main-report.md", title: "Main coordinator evidence", taskId: "T1" });
	}
	if (input === "R2 main worker" && !tool) return call("worker_spawn", { id: "proof-worker", task: "Save actual worker evidence for T1.", isolation: "shared" });
	if (input === "R2 flood" && !tool) return call("codemode", { code: `for (let i = 0; i < 501; i++) { const path = ${JSON.stringify(join(project, "window-proof-"))} + i + ".txt"; await tools.write({ path, content: "Synthetic list-window proof " + i }); await tools.artifact_save({ path, title: "Window proof " + i }); } return "501 real artifact_save calls completed";` });
	if (input === "R2 message" && !tool) return call("thread_send", { id: PROOF_THREAD, message: "Real steering from main", reply: false });
	if (input === "R2 inspect") {
		if (!tool) return call("thread_list", {});
		if (tool === "thread_list") return call("thread_peek", { id: PROOF_THREAD });
	}
	if (input === "R2 failure") {
		// Every thread starts for a board task: T2, after the proof's T1.
		if (!tool) return call("board", { action: "add_task", title: "Failure proof" });
		if (tool === "board") return call("thread_start", { title: "Failure proof", brief: "Fail deterministically.", onFinish: "review", taskId: "T2" });
	}
	if (input === "R2 stop" && !tool) return call("thread_stop", { id: PROOF_THREAD });
	if (input === "R2 archive" && !tool) return call("thread_archive", { id: PROOF_THREAD });
	if (tool) return say(`Real ${tool} completed.`);
	if (text.startsWith("[thread ")) return say("Reviewed the real background result.");
	if (text.startsWith("[from ")) return say("Read the real thread message.");
	if (text.startsWith("[board]")) return say("Read the real shared-board notice.");
	return say("# Real checkout server\n\nThis answer uses the **faux provider**. Persistence, WebSocket, conversation streaming and APIs are real; no external model was contacted.\n\nSend R2 start to run actual thread/artifact tools.");
}
