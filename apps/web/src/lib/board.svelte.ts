/**
 * One project's board, live: the server pushes the whole board on every change (`board.state`), so a screen replaces
 * what it holds; `board.get` fills it in on connect and after a reconnect. Archived tasks are not pushed, so they are
 * read when the user asks for them and again after each push while they are shown. Saves and answers go through here and
 * report a conflict as an outcome, with the newer row read back, instead of throwing.
 */
import { taskActivitySupported } from './task-activity.js';
import { boardConflict, boardStateIsFor, type HarnessClient } from "@aiki/client";
import type {
	Board,
	BoardFeedback,
	BoardFeedbackState,
	BoardQuestion,
	BoardTask,
	BoardTaskBrief,
	BoardTaskInput,
	BoardTaskSnapshot,
	BoardTimelineEntry,
} from "@aiki/protocol";

export type SaveOutcome =
	| { kind: "saved"; task: BoardTask }
	/** The row moved on; `newer` is its current state, undefined when it is gone. */
	| { kind: "conflict"; newer: BoardTask | undefined }
	| { kind: "failed"; message: string };

export type AnswerOutcome =
	| { kind: "answered"; question: BoardQuestion }
	| { kind: "conflict"; newer: BoardQuestion | undefined }
	| { kind: "failed"; message: string };

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export class ProjectBoard {
	readonly projectId: string;
	board = $state<Board | undefined>(undefined);
	/** Archived tasks, read while `showArchived` is on. */
	archived = $state<BoardTask[]>([]);
	showArchived = $state(false);
	loaded = $state(false);
	/** Activity requires an explicit hello capability, unlike legacy assumed support. */
	activityEnabled = $state(false);
	error = $state<string | undefined>(undefined);

	/** Live tasks and, when asked for, the archived ones. */
	readonly tasks = $derived.by(() => {
		const live = this.board?.tasks ?? [];
		if (!this.showArchived) return live;
		const ids = new Set(live.map((task) => task.id));
		return [...live, ...this.archived.filter((task) => !ids.has(task.id))];
	});
	readonly openQuestionCount = $derived((this.board?.questions ?? []).filter((question) => question.status === "open").length);

	readonly #client: HarnessClient;
	readonly #unsubscribeBoard: () => void;
	readonly #unsubscribeState: () => void;
	#stopped = false;

	constructor(client: HarnessClient, projectId: string) {
		this.projectId = projectId;
		this.#client = client;
		this.#unsubscribeBoard = client.onBoardState((state) => {
			if (this.#stopped || !boardStateIsFor(state, projectId)) return;
			this.#apply(state.board);
			if (this.showArchived) void this.#readArchived();
		});
		// A reconnect loses the pushes sent while away, so ask for the board again.
		this.#unsubscribeState = client.subscribe((state) => {
			if (state.status === "ready") {
				this.activityEnabled = taskActivitySupported(state.features);
				void this.load();
			}
		});
		if (client.connected) void this.load();
	}

	async load(): Promise<void> {
		if (this.#stopped || !this.#client.connected) return;
		try {
			const board = await this.#client.readBoard(this.projectId, { includeArchived: this.showArchived });
			if (this.#stopped) return;
			this.#apply(board);
			if (this.showArchived) this.archived = board.tasks.filter((task) => task.archived);
		} catch (error) {
			if (this.#stopped) return;
			this.error = messageOf(error);
		}
	}

	async setShowArchived(show: boolean): Promise<void> {
		this.showArchived = show;
		if (show) await this.#readArchived();
		else this.archived = [];
	}

	task(id: string): BoardTask | undefined {
		return this.tasks.find((task) => task.id === id);
	}

	question(id: string): BoardQuestion | undefined {
		return this.board?.questions.find((question) => question.id === id);
	}

	/** An archived task (settled for more than a week), which the live board leaves out; undefined when it is gone. */
	async findArchived(id: string): Promise<BoardTask | undefined> {
		const board = await this.#client.readBoard(this.projectId, { includeArchived: true });
		return board.tasks.find((task) => task.id === id);
	}

	/** A task's snapshots, oldest first. */
	history(taskId: string): Promise<BoardTaskSnapshot[]> {
		return this.#client.readTaskHistory(this.projectId, taskId);
	}

	/** A task's timeline, oldest first, and its feedback entries, open ones first. */
	timeline(taskId: string): Promise<{ entries: BoardTimelineEntry[]; feedback: BoardFeedback[] }> {
		return this.#client.readTaskTimeline(this.projectId, taskId);
	}

	/** Dismiss, reopen or otherwise set a feedback entry; the entry as stored. Throws what the server refused with. */
	setFeedback(taskId: string, feedbackId: string, state: BoardFeedbackState, note?: string): Promise<BoardFeedback> {
		return this.#client.setFeedbackState(this.projectId, taskId, feedbackId, state, note);
	}

	/** Archived tasks that the shown tasks link to, so a link to one can still name it. */
	readonly archivedLinks = $derived<readonly BoardTaskBrief[]>(this.board?.archivedLinks ?? []);

	/**
	 * Create (no `taskId`) or change a task read at `expectedRevision`. A `note` (why the user made the change) reaches the
	 * coordinator with it, on a backend with `board-moves`.
	 */
	async saveTask(
		input: BoardTaskInput,
		options: { taskId?: string; expectedRevision?: number; note?: string } = {},
	): Promise<SaveOutcome> {
		try {
			const task = await this.#client.saveBoardTask(this.projectId, input, options);
			if (!this.#stopped) this.#upsertTask(task);
			return { kind: "saved", task };
		} catch (error) {
			if (boardConflict(error)) {
				await this.#refresh();
				return { kind: "conflict", newer: options.taskId === undefined ? undefined : this.task(options.taskId) };
			}
			return { kind: "failed", message: messageOf(error) };
		}
	}

	/** Put the shown tasks in this order. The list moves at once; a refusal reads the board again. */
	async reorder(taskIds: string[]): Promise<string | undefined> {
		const previous = this.board;
		if (previous !== undefined) {
			const position = new Map(taskIds.map((id, index) => [id, index]));
			const reordered = previous.tasks.map((task) => ({ ...task, order: position.get(task.id) ?? task.order + taskIds.length }));
			this.board = { ...previous, tasks: reordered.sort((left, right) => left.order - right.order) };
		}
		try {
			await this.#client.reorderBoardTasks(this.projectId, taskIds);
			return undefined;
		} catch (error) {
			await this.#refresh();
			return messageOf(error);
		}
	}

	async answer(questionId: string, expectedRevision: number, answer: string): Promise<AnswerOutcome> {
		try {
			const question = await this.#client.answerBoardQuestion(this.projectId, questionId, expectedRevision, answer);
			if (!this.#stopped) this.#upsertQuestion(question);
			return { kind: "answered", question };
		} catch (error) {
			if (boardConflict(error)) {
				await this.#refresh();
				return { kind: "conflict", newer: this.question(questionId) };
			}
			return { kind: "failed", message: messageOf(error) };
		}
	}

	stop(): void {
		this.#stopped = true;
		this.#unsubscribeState();
		this.#unsubscribeBoard();
	}

	async #refresh(): Promise<void> {
		await this.load();
	}

	async #readArchived(): Promise<void> {
		try {
			const board = await this.#client.readBoard(this.projectId, { includeArchived: true });
			if (!this.#stopped) this.archived = board.tasks.filter((task) => task.archived);
		} catch (error) {
			if (!this.#stopped) this.error = messageOf(error);
		}
	}

	#apply(board: Board): void {
		this.board = { ...board, tasks: board.tasks.filter((task) => !task.archived) };
		this.loaded = true;
		this.error = undefined;
	}

	#upsertTask(task: BoardTask): void {
		if (this.board === undefined) return;
		const tasks = [...this.board.tasks];
		const index = tasks.findIndex((entry) => entry.id === task.id);
		if (index === -1) tasks.push(task);
		else tasks[index] = task;
		this.board = { ...this.board, tasks: tasks.filter((entry) => !entry.archived).sort((left, right) => left.order - right.order) };
	}

	#upsertQuestion(question: BoardQuestion): void {
		if (this.board === undefined) return;
		const questions = this.board.questions.map((entry) => (entry.id === question.id ? question : entry));
		this.board = { ...this.board, questions };
	}
}
