/**
 * The board requests and the pushed board, against a stub socket: their shapes are the client's own contract, so they are
 * pinned here without a server.
 */
import { afterEach, describe, expect, it } from "bun:test";
import type { Board, BoardQuestion, BoardTask, BoardTaskInput } from "@aiki/protocol";
import {
	BOARD_CONFLICT_CODE,
	ClientError,
	HarnessClient,
	boardConflict,
	boardStateIsFor,
	formatMinutes,
	inProgressText,
	isBoardMessage,
	parseTaskReference,
	type HarnessWebSocket,
} from "../src/index.ts";

type StubMessage = { type: string; id?: string; [key: string]: unknown };

class StubSocket implements HarnessWebSocket {
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;
	readonly sent: StubMessage[] = [];

	constructor(readonly answer: (message: StubMessage) => unknown) {}

	send(data: string): void {
		const message = JSON.parse(data) as StubMessage;
		this.sent.push(message);
		const response = this.answer(message);
		if (response !== undefined) this.push(response);
	}

	push(message: unknown): void {
		this.onmessage?.({ data: JSON.stringify(message) });
	}

	close(): void {
		this.onclose?.({ code: 1000, reason: "stub closed" });
	}
}

const clients: HarnessClient[] = [];

function clientFor(answer: (message: StubMessage) => unknown): { client: HarnessClient; socket: StubSocket } {
	const socket = new StubSocket((message) => {
		if (message.type === "hello") {
			return {
				type: "hello",
				id: message.id,
				protocolVersion: 1,
				server: { name: "stub", version: "0" },
				features: ["projects", "board"],
			};
		}
		return answer(message);
	});
	const client = new HarnessClient({
		url: "ws://stub.invalid/ws",
		clientName: "board-test",
		requestTimeoutMs: 2_000,
		reconnect: false,
		webSocketFactory: () => {
			queueMicrotask(() => socket.onopen?.());
			return socket;
		},
	});
	clients.push(client);
	return { client, socket };
}

afterEach(() => {
	for (const client of clients.splice(0)) client.close();
});

function task(overrides: Partial<BoardTask> = {}): BoardTask {
	return {
		id: "T1",
		revision: 1,
		title: "Fix parser recovery",
		description: "",
		acceptance: null,
		refs: [],
		status: "todo",
		blockedBy: [],
		blockedReason: null,
		writeScopes: [],
		workerIds: [],
		scheduleId: null,
		order: 1,
		createdBy: "coordinator",
		updatedBy: "coordinator",
		createdAt: "2026-11-04T10:00:00.000Z",
		updatedAt: "2026-11-04T10:00:00.000Z",
		settledAt: null,
		archived: false,
		report: { now: "", results: "", next: "", revision: 0, updatedAt: null, updatedBy: null },
		snapshots: 0,
		...overrides,
	};
}

function question(overrides: Partial<BoardQuestion> = {}): BoardQuestion {
	return {
		id: "Q1",
		revision: 1,
		text: "Which database?",
		options: ["sqlite", "postgres"],
		taskId: null,
		status: "open",
		answer: null,
		askedAt: "2026-11-04T10:00:00.000Z",
		answeredAt: null,
		...overrides,
	};
}

const BOARD: Board = { tasks: [task()], questions: [question()], decisions: [], updatedAt: "2026-11-04T10:00:00.000Z" };

const INPUT: BoardTaskInput = {
	title: "Fix parser recovery",
	description: "It loses its place after a bad token.",
	acceptance: "The parser tests pass.",
	status: "todo",
	blockedBy: [],
	blockedReason: null,
	writeScopes: ["src/parser"],
};

describe("board.get", () => {
	it("asks for the live board by default and for archived tasks on request", async () => {
		const { client, socket } = clientFor((message) =>
			message.type === "board.get" ? { type: "board.get", id: message.id, board: BOARD } : undefined,
		);
		client.connect();
		await client.whenReady();

		expect(await client.readBoard("project-1")).toEqual(BOARD);
		await client.readBoard("project-1", { includeArchived: true });
		const requests = socket.sent.filter((message) => message.type === "board.get");
		expect(requests[0]).toMatchObject({ projectId: "project-1" });
		expect(requests[0]?.includeArchived).toBeUndefined();
		expect(requests[1]).toMatchObject({ projectId: "project-1", includeArchived: true });
	});
});

describe("board.task.save", () => {
	it("creates a task without an ID or a revision", async () => {
		const { client, socket } = clientFor((message) =>
			message.type === "board.task.save"
				? { type: "board.task.save", id: message.id, task: task({ id: "T2", title: INPUT.title }) }
				: undefined,
		);
		client.connect();
		await client.whenReady();

		expect(await client.saveBoardTask("project-1", INPUT)).toMatchObject({ id: "T2" });
		const request = socket.sent.find((message) => message.type === "board.task.save");
		expect(request).toMatchObject({ projectId: "project-1", task: INPUT });
		expect(request?.taskId).toBeUndefined();
		expect(request?.expectedRevision).toBeUndefined();
	});

	it("names the task and the revision it was read at when changing one", async () => {
		const { client, socket } = clientFor((message) =>
			message.type === "board.task.save"
				? { type: "board.task.save", id: message.id, task: task({ revision: 4 }) }
				: undefined,
		);
		client.connect();
		await client.whenReady();

		const saved = await client.saveBoardTask("project-1", INPUT, { taskId: "T1", expectedRevision: 3 });
		expect(saved.revision).toBe(4);
		expect(socket.sent.find((message) => message.type === "board.task.save")).toMatchObject({
			projectId: "project-1",
			taskId: "T1",
			expectedRevision: 3,
			task: INPUT,
		});
	});

	it("rejects with a conflict the app can tell from other failures", async () => {
		const { client } = clientFor((message) =>
			message.type === "board.task.save"
				? { type: "error", id: message.id, error: { code: "board_conflict", message: "T1 changed since revision 3." } }
				: undefined,
		);
		client.connect();
		await client.whenReady();

		const error = await client
			.saveBoardTask("project-1", INPUT, { taskId: "T1", expectedRevision: 3 })
			.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(ClientError);
		expect(boardConflict(error)).toBe(true);
		expect((error as ClientError).code).toBe(BOARD_CONFLICT_CODE);
	});
});

describe("board.tasks.reorder and board.question.answer", () => {
	it("sends the new order", async () => {
		const { client, socket } = clientFor((message) =>
			message.type === "board.tasks.reorder" ? { type: "board.tasks.reorder", id: message.id } : undefined,
		);
		client.connect();
		await client.whenReady();

		await client.reorderBoardTasks("project-1", ["T3", "T1"]);
		expect(socket.sent.find((message) => message.type === "board.tasks.reorder")).toMatchObject({
			projectId: "project-1",
			taskIds: ["T3", "T1"],
		});
	});

	it("answers a question on the revision it was read at", async () => {
		const { client, socket } = clientFor((message) =>
			message.type === "board.question.answer"
				? {
						type: "board.question.answer",
						id: message.id,
						question: question({ revision: 2, status: "answered", answer: "sqlite" }),
					}
				: undefined,
		);
		client.connect();
		await client.whenReady();

		const answered = await client.answerBoardQuestion("project-1", "Q1", 1, "sqlite");
		expect(answered).toMatchObject({ id: "Q1", status: "answered", answer: "sqlite" });
		expect(socket.sent.find((message) => message.type === "board.question.answer")).toMatchObject({
			projectId: "project-1",
			questionId: "Q1",
			expectedRevision: 1,
			answer: "sqlite",
		});
	});
});

describe("board.task.history", () => {
	it("asks for a task's snapshots and returns them oldest first", async () => {
		const snapshots = [
			{
				seq: 1,
				at: "2026-11-05T10:00:00.000Z",
				label: "First version merged",
				by: { author: "worker", threadId: "main", workerId: "w1" },
				title: "Fix parser recovery",
				status: "in_progress",
				report: { now: "", results: "- merged", next: "" },
			},
		];
		const { client, socket } = clientFor((message) =>
			message.type === "board.task.history" ? { type: "board.task.history", id: message.id, taskId: "T1", snapshots } : undefined,
		);
		client.connect();
		await client.whenReady();

		expect(await client.readTaskHistory("project-1", "T1")).toEqual(snapshots as never);
		expect(socket.sent.find((message) => message.type === "board.task.history")).toMatchObject({
			projectId: "project-1",
			taskId: "T1",
		});
	});
});

describe("board.state", () => {
	it("reaches every listener with the project and its whole board", async () => {
		const { client, socket } = clientFor(() => undefined);
		const seen: { projectId: string; board: Board }[] = [];
		client.onBoardState((state) => seen.push(state));
		client.connect();
		await client.whenReady();

		socket.push({ type: "board.state", projectId: "project-1", board: BOARD });
		socket.push({ type: "board.state", projectId: "project-2", board: { ...BOARD, tasks: [] } });

		expect(seen.map((state) => state.projectId)).toEqual(["project-1", "project-2"]);
		expect(seen[0]?.board).toEqual(BOARD);
		expect(boardStateIsFor(seen[0] as { projectId: string }, "project-1")).toBe(true);
		expect(boardStateIsFor(seen[1] as { projectId: string }, "project-1")).toBe(false);
	});

	it("keeps a throwing listener from breaking the others", async () => {
		const { client, socket } = clientFor(() => undefined);
		let reached = 0;
		client.onBoardState(() => {
			throw new Error("listener bug");
		});
		client.onBoardState(() => (reached += 1));
		client.connect();
		await client.whenReady();

		socket.push({ type: "board.state", projectId: "project-1", board: BOARD });
		expect(reached).toBe(1);
	});
});

describe("board helpers", () => {
	it("tells a conflict from any other error", () => {
		expect(boardConflict(new ClientError("board_conflict", "moved"))).toBe(true);
		expect(boardConflict(new ClientError("unknown_task", "no T9"))).toBe(false);
		expect(boardConflict(new Error("board_conflict"))).toBe(false);
		expect(boardConflict(undefined)).toBe(false);
	});

	it("recognises the harness's [board] notes and nothing typed", () => {
		expect(isBoardMessage("[board] A user edited T3")).toBe(true);
		expect(isBoardMessage("[board]\nA user added T7")).toBe(true);
		expect(isBoardMessage("  [board]")).toBe(true);
		expect(isBoardMessage("[boards] nope")).toBe(false);
		expect(isBoardMessage("please read [board]")).toBe(false);
		expect(isBoardMessage("[check-in]\nworker w1 running")).toBe(false);
	});
});

describe("time in progress", () => {
	it("reads the minutes a task spent in progress", () => {
		expect(inProgressText({})).toBeUndefined();
		expect(inProgressText({ inProgressMinutes: 0 })).toBe("In progress 0m");
		expect(inProgressText({ inProgressMinutes: 80 })).toBe("In progress 1h 20m");
	});

	it("formats minutes", () => {
		expect(formatMinutes(0)).toBe("0m");
		expect(formatMinutes(45)).toBe("45m");
		expect(formatMinutes(120)).toBe("2h");
		expect(formatMinutes(95)).toBe("1h 35m");
	});
});

describe("the task timeline and feedback", () => {
	it("asks for a task's timeline, with or without kinds, and sets a feedback entry", async () => {
		const entry = { id: "F1", text: "Make it blue.", threadId: "main", at: "2026-11-09T10:00:00.000Z", state: "open", note: null, updatedAt: "2026-11-09T10:00:00.000Z", changes: [] };
		const { client, socket } = clientFor((message) => {
			if (message.type === "board.task.timeline") {
				return { type: "board.task.timeline", id: message.id, taskId: message.taskId, entries: [{ at: entry.at, kind: "feedback", label: "Feedback F1" }], feedback: [entry] };
			}
			if (message.type === "board.feedback.set") {
				return { type: "board.feedback.set", id: message.id, feedback: { ...entry, state: message.state, note: message.note ?? null } };
			}
			return undefined;
		});
		await client.connect();
		const all = await client.readTaskTimeline("p1", "T1");
		expect(all.entries.map((item) => item.label)).toEqual(["Feedback F1"]);
		expect(all.feedback[0]?.id).toBe("F1");
		await client.readTaskTimeline("p1", "T1", { kinds: ["feedback", "worker"] });
		const dismissed = await client.setFeedbackState("p1", "T1", "F1", "dismissed", "not needed");
		expect(dismissed).toMatchObject({ state: "dismissed", note: "not needed" });
		await client.setFeedbackState("p1", "T1", "F1", "open");
		const sent = socket.sent.filter((message) => message.type.startsWith("board."));
		expect(sent[0]).toMatchObject({ type: "board.task.timeline", projectId: "p1", taskId: "T1" });
		expect("kinds" in (sent[0] as object)).toBe(false);
		expect(sent[1]).toMatchObject({ kinds: ["feedback", "worker"] });
		expect(sent[2]).toMatchObject({ type: "board.feedback.set", feedbackId: "F1", state: "dismissed", note: "not needed" });
		expect("note" in (sent[3] as object)).toBe(false);
	});

	it("reads the feedback ID out of a task reference", () => {
		expect(parseTaskReference("[task T12, feedback F3] fix it")).toEqual({ taskId: "T12", feedbackId: "F3", text: "fix it" });
		expect(parseTaskReference("[task T12] fix it")).toEqual({ taskId: "T12", feedbackId: null, text: "fix it" });
		expect(parseTaskReference("[task T 1] odd")).toEqual({ taskId: null, feedbackId: null, text: "[task T 1] odd" });
		expect(parseTaskReference("plain")).toEqual({ taskId: null, feedbackId: null, text: "plain" });
	});
});
