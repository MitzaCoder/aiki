/**
 * Waiting messages (feature `queued-inputs`): an input sent while a run is busy shows in the view's `queued` list, a
 * second watch sees it too, withdrawing takes it back, and the entry it becomes carries its submission ID.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { ConversationView } from "@aiki/protocol";
import { describeContent, splitTaskReference } from "../src/queued-inputs.ts";
import { entryText, TestClient, ViewClient, createSetup, type TestSetup } from "./support.ts";

const cleanups: (() => Promise<void>)[] = [];
const clients: TestClient[] = [];

async function setup(): Promise<TestSetup> {
	const created = await createSetup();
	cleanups.push(created.cleanup);
	return created;
}

async function connect(server: TestSetup["server"]): Promise<TestClient> {
	const client = await TestClient.open(server);
	clients.push(client);
	await client.hello();
	return client;
}

afterEach(async () => {
	for (const client of clients.splice(0)) client.close();
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve: () => void = () => undefined;
	const promise = new Promise<void>((settle) => {
		resolve = () => settle();
	});
	return { promise, resolve };
}

async function project(test: TestSetup, client: TestClient): Promise<string> {
	const added = await client.request({ type: "projects.add", path: test.projectDir });
	if (added.type !== "projects.add") throw new Error(JSON.stringify(added));
	await client.request({
		type: "projects.configure",
		projectId: added.project.id,
		coordinatorModel: { provider: "faux", modelId: "faux-1" },
		coordinatorThinkingLevel: "low",
	});
	return added.project.id;
}

type SubmitAnswer = { type: string; submissionId?: number; status?: string };

async function submit(
	client: TestClient,
	projectId: string,
	requestId: string,
	content: string,
	extra: { whenBusy?: "steer" | "followUp"; taskId?: string } = {},
): Promise<SubmitAnswer> {
	return (await client.request({ type: "conversation.submit", projectId, requestId, content, ...extra })) as SubmitAnswer;
}

function userTexts(view: ConversationView): string[] {
	return view.entries.filter((entry) => entry.kind === "pi.user").map((entry) => entryText(entry));
}

/** A first model response held in flight, then a bash call, so the run has a tool boundary to place a steer at. */
function slowRun(test: TestSetup): { reached: Promise<void>; release: () => void } {
	const reached = deferred();
	const release = deferred();
	test.faux.setResponses([
		async () => {
			reached.resolve();
			await release.promise;
			return fauxAssistantMessage([fauxToolCall("bash", { command: "echo hi" })], { stopReason: "toolUse" });
		},
		fauxAssistantMessage("Took the steer."),
	]);
	return { reached: reached.promise, release: release.resolve };
}

describe("queued inputs", () => {
	it("shows a steer waiting, to every watch, and hands it to the entry it becomes by ID", async () => {
		const test = await setup();
		const client = await connect(test.server);
		const projectId = await project(test, client);
		const view = new ViewClient(client);
		await view.start(projectId);
		const run = slowRun(test);
		const saved = await client.request({
			type: "board.task.save",
			projectId,
			task: { title: "Fix it", description: "", acceptance: null, status: "todo", blockedBy: [], blockedReason: null, writeScopes: [] },
		});
		if (saved.type !== "board.task.save") throw new Error(JSON.stringify(saved));
		const taskId = saved.task.id;

		expect((await submit(client, projectId, "first", "start")).status).toBe("placed");
		await run.reached;

		const waiting = await submit(client, projectId, "second", "also do this", { whenBusy: "steer", taskId });
		expect(waiting.status).toBe("queued");
		const queued = await view.waitForView((value) => (value.queued?.length ?? 0) === 1);
		expect(queued.queued?.[0]).toMatchObject({
			id: waiting.submissionId,
			requestId: "second",
			mode: "steer",
			text: "also do this",
			taskId,
		});
		expect(typeof queued.queued?.[0]?.at).toBe("number");
		expect(userTexts(queued)).toEqual(["start"]);

		// A second device that opens now sees the same waiting message.
		const other = await connect(test.server);
		const otherView = new ViewClient(other);
		await otherView.start(projectId);
		expect(otherView.view?.queued?.map((item) => item.requestId)).toEqual(["second"]);

		run.release();
		const placed = await view.waitForView((value) => value.queued === undefined && userTexts(value).length === 2);
		const entry = placed.entries.filter((candidate) => candidate.kind === "pi.user")[1];
		// The same update that emptied the queue says which entry the waiting message became.
		expect(entry?.submissionId).toBe(waiting.submissionId);
		expect(entryText(entry!)).toBe(`[task ${taskId}, feedback F1] also do this`);
		await view.waitForView((value) => value.entries.some((candidate) => entryText(candidate) === "Took the steer."));
	});

	it("withdraws one waiting input, and says so when it was already placed or never waited", async () => {
		const test = await setup();
		const client = await connect(test.server);
		const projectId = await project(test, client);
		const view = new ViewClient(client);
		await view.start(projectId);
		const run = slowRun(test);

		await submit(client, projectId, "first", "start");
		await run.reached;
		const kept = await submit(client, projectId, "kept", "keep me", { whenBusy: "steer" });
		const dropped = await submit(client, projectId, "dropped", "drop me", { whenBusy: "steer" });
		await view.waitForView((value) => (value.queued?.length ?? 0) === 2);

		const withdrawn = await client.request({ type: "conversation.withdraw", projectId, submissionId: dropped.submissionId! });
		expect(withdrawn).toMatchObject({ type: "conversation.withdraw", outcome: "withdrawn" });
		const left = await view.waitForView((value) => value.queued?.length === 1);
		expect(left.queued?.[0]?.requestId).toBe("kept");
		expect(
			await client.request({ type: "conversation.withdraw", projectId, submissionId: dropped.submissionId! }),
		).toMatchObject({ outcome: "gone" });

		run.release();
		const done = await view.waitForView((value) => value.queued === undefined && userTexts(value).length === 2);
		// The withdrawn one never reached the model; the other did.
		expect(userTexts(done)).toEqual(["start", "keep me"]);
		expect(
			await client.request({ type: "conversation.withdraw", projectId, submissionId: kept.submissionId! }),
		).toMatchObject({ outcome: "already_placed" });
	});

	it("places a follow-up left over when the run ends, and starts the next turn with it", async () => {
		const test = await setup();
		const client = await connect(test.server);
		const projectId = await project(test, client);
		const view = new ViewClient(client);
		await view.start(projectId);
		const reached = deferred();
		const release = deferred();
		test.faux.setResponses([
			async () => {
				reached.resolve();
				await release.promise;
				return fauxAssistantMessage("First answer.");
			},
			fauxAssistantMessage("Second answer."),
		]);

		await submit(client, projectId, "first", "start");
		await reached.promise;
		const later = await submit(client, projectId, "later", "and then this", { whenBusy: "followUp" });
		await view.waitForView((value) => value.queued?.[0]?.mode === "followUp");
		release.resolve();

		const answered = await view.waitForView((value) =>
			value.entries.some((entry) => entryText(entry) === "Second answer."),
		);
		expect(userTexts(answered)).toEqual(["start", "and then this"]);
		expect(answered.queued).toBeUndefined();
		expect(answered.entries.find((entry) => entryText(entry) === "and then this")?.submissionId).toBe(later.submissionId);
	});

	it("keeps a re-sent request ID from queueing twice", async () => {
		const test = await setup();
		const client = await connect(test.server);
		const projectId = await project(test, client);
		const view = new ViewClient(client);
		await view.start(projectId);
		const run = slowRun(test);
		await submit(client, projectId, "first", "start");
		await run.reached;
		const one = await submit(client, projectId, "same", "once", { whenBusy: "steer" });
		const again = await submit(client, projectId, "same", "once", { whenBusy: "steer" });
		expect(again.submissionId).toBe(one.submissionId);
		expect(again.status).toBe("queued");
		await view.waitForView((value) => (value.queued?.length ?? 0) === 1);
		run.release();
		await view.waitForView((value) => value.queued === undefined && userTexts(value).length === 2);
	});
});

describe("describing a queued input", () => {
	it("reads the text and image count of string and block content", () => {
		expect(describeContent("plain")).toEqual({ text: "plain", images: 0 });
		expect(
			describeContent([
				{ type: "text", text: "look" },
				{ type: "image", data: "x", mimeType: "image/png" },
				{ type: "text", text: "here" },
			]),
		).toEqual({ text: "look\nhere", images: 1 });
		expect(describeContent(undefined)).toEqual({ text: "", images: 0 });
	});

	it("takes the task reference off the text", () => {
		expect(splitTaskReference("[task T12] fix it")).toEqual({ taskId: "T12", text: "fix it" });
		expect(splitTaskReference("no reference")).toEqual({ text: "no reference" });
		expect(splitTaskReference("[task T 1] odd")).toEqual({ text: "[task T 1] odd" });
	});
});
