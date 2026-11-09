/** Event schedules: a GitHub review request starts a run, once per request, through a fake `gh` (no network). */
import { afterEach, describe, expect, it } from "bun:test";
import type { TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import type { Board, BoardTask, ModelRef, Schedule, ScheduleInput, ScheduleSpec } from "@mihai-harness/protocol";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CommandResult, RunCommand } from "../src/host-commands.ts";
import {
	eventBriefBlock,
	eventRunIdentity,
	listenedRepos,
	reviewRequestsFrom,
	type ReviewRequest,
} from "../src/schedule-events.ts";
import { validateSpec } from "../src/schedules.ts";
import { createSetup, errorOf, TestClient, type TestSetup } from "./support.ts";

const cleanups: (() => Promise<void>)[] = [];
const clients: TestClient[] = [];

const FAUX: ModelRef = { provider: "faux", modelId: "faux-1" };
const WORKER_BRIEF = "Review the pull request and report what you find.";
const THREAD_BRIEF = "Review the pull request as a thread and finish with a summary.";
const ME = "sample-user";
const MY_TEAM = "acme/frontend-admins";
const PLATFORM = "acme/platform";
const OTHER = "acme/other-repo";

async function setup(options?: Parameters<typeof createSetup>[0]): Promise<TestSetup> {
	const created = await createSetup(options);
	cleanups.push(created.cleanup);
	return created;
}

async function connect(server: TestSetup["server"]): Promise<TestClient> {
	const client = await TestClient.open(server);
	clients.push(client);
	return client;
}

afterEach(async () => {
	for (const client of clients.splice(0)) client.close();
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

function eventTest(name: string, run: () => Promise<void>): void {
	it(name, run, 60_000);
}

async function until(check: () => Promise<boolean> | boolean, timeoutMs = 20_000): Promise<void> {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("timed out waiting for a condition");
}

// --- a fake `gh` ---------------------------------------------------------------------------------------------------

type Who = { user: string } | { team: string };
type FakePull = {
	repo: string;
	number: number;
	title: string;
	sha: string;
	events: { id: string; at: string; who: Who }[];
	pending: Who[];
};

const sameWho = (left: Who, right: Who): boolean =>
	"user" in left ? "user" in right && left.user === right.user : "team" in right && left.team === right.team;

class FakeGithub {
	viewer = ME;
	/** The teams the account really belongs to. */
	memberOf: string[] = [MY_TEAM];
	/** What `gh api user/teams` answers; null makes that call fail. */
	teamsAnswer: string[] | null = [MY_TEAM];
	/** When set, the review search fails with this message. */
	failure: string | null = null;
	searches = 0;
	readonly pulls = new Map<string, FakePull>();
	#events = 0;

	/** A review request: a new event on the pull request, which is pending until `clear`ed. */
	request(repo: string, number: number, who: Who, at: string, title = `Change ${number}`): void {
		const key = `${repo}#${number}`;
		const pull = this.pulls.get(key) ?? { repo, number, title, sha: `sha-${number}-0`, events: [], pending: [] };
		this.#events += 1;
		pull.events.push({ id: `RRE_${this.#events}`, at, who });
		if (!pull.pending.some((entry) => sameWho(entry, who))) pull.pending.push(who);
		this.pulls.set(key, pull);
	}

	/** The reviewer reviewed, or the request was withdrawn. */
	clear(repo: string, number: number, who: Who): void {
		const pull = this.pulls.get(`${repo}#${number}`);
		if (pull !== undefined) pull.pending = pull.pending.filter((entry) => !sameWho(entry, who));
	}

	/** New commits on the branch: the head commit changes, no request does. */
	push(repo: string, number: number): void {
		const pull = this.pulls.get(`${repo}#${number}`);
		if (pull !== undefined) pull.sha = `${pull.sha}+`;
	}

	readonly run: RunCommand = async (command, args) => {
		const done = (stdout: string, exitCode = 0, stderr = ""): CommandResult => ({ exitCode, stdout, stderr, missing: false });
		if (command !== "gh") return { exitCode: null, stdout: "", stderr: "", missing: true };
		if (args.includes("user/teams")) {
			return this.teamsAnswer === null ? done("", 1, "HTTP 403") : done(this.teamsAnswer.join("\n"));
		}
		this.searches += 1;
		if (this.failure !== null) return done("", 1, this.failure);
		const reviewer = (who: Who) =>
			"user" in who
				? { __typename: "User", login: who.user }
				: { __typename: "Team", slug: who.team.split("/")[1], organization: { login: who.team.split("/")[0] } };
		const matches = (pull: FakePull): boolean =>
			pull.pending.some((who) => ("user" in who ? who.user === this.viewer : this.memberOf.includes(who.team)));
		const nodes = [...this.pulls.values()]
			.filter(matches)
			.map((pull) => ({
				number: pull.number,
				url: `https://github.com/${pull.repo}/pull/${pull.number}`,
				title: pull.title,
				isDraft: false,
				baseRefName: "main",
				headRefName: `feature/${pull.number}`,
				headRefOid: pull.sha,
				repository: { nameWithOwner: pull.repo },
				author: { login: "alice" },
				reviewRequests: { nodes: pull.pending.map((who) => ({ requestedReviewer: reviewer(who) })) },
				timelineItems: {
					nodes: pull.events.map((event) => ({
						__typename: "ReviewRequestedEvent",
						id: event.id,
						createdAt: event.at,
						requestedReviewer: reviewer(event.who),
					})),
				},
			}));
		return done(JSON.stringify({ data: { viewer: { login: this.viewer }, search: { nodes } } }));
	};
}

// --- protocol helpers ----------------------------------------------------------------------------------------------

async function addProject(client: TestClient, path: string, githubRepos?: string[]): Promise<string> {
	expect((await client.hello()).type).toBe("hello");
	const added = await client.request({ type: "projects.add", path });
	if (added.type !== "projects.add") throw errorOf(added);
	const configured = await client.request({
		type: "projects.configure",
		projectId: added.project.id,
		coordinatorModel: FAUX,
		workerModels: [FAUX],
		...(githubRepos === undefined ? {} : { links: { jiraSite: null, jiraProjects: [], githubRepos } }),
	});
	if (configured.type !== "projects.configure") throw errorOf(configured);
	return added.project.id;
}

function scheduleInput(overrides: Partial<ScheduleInput> = {}): ScheduleInput {
	return {
		title: "Review requests",
		brief: WORKER_BRIEF,
		spec: { kind: "github-review-requested" },
		model: null,
		thinkingLevel: null,
		isolation: "shared",
		onReport: "record",
		enabled: true,
		...overrides,
	};
}

async function saveSchedule(client: TestClient, projectId: string, input: ScheduleInput, scheduleId?: string): Promise<Schedule> {
	const response = await client.request({
		type: "schedules.save",
		projectId,
		...(scheduleId === undefined ? {} : { scheduleId }),
		schedule: input,
	});
	if (response.type !== "schedules.save") throw errorOf(response);
	return response.schedule;
}

async function schedule(client: TestClient, projectId: string, id: string): Promise<Schedule> {
	const response = await client.request({ type: "schedules.list", projectId });
	if (response.type !== "schedules.list") throw errorOf(response);
	return response.schedules.find((entry) => entry.id === id) as Schedule;
}

async function board(client: TestClient, projectId: string): Promise<Board> {
	const response = await client.request({ type: "board.get", projectId, includeArchived: false });
	if (response.type !== "board.get") throw errorOf(response);
	return response.board;
}

async function reviewTasks(client: TestClient, projectId: string): Promise<BoardTask[]> {
	return (await board(client, projectId)).tasks.filter((task) => task.title.startsWith("Review PR:"));
}

async function startedRuns(client: TestClient, projectId: string, id: string): Promise<Schedule["runs"]> {
	return (await schedule(client, projectId, id)).runs.filter((run) => run.outcome === "started");
}

/** A model that records what it is asked, reports as a worker and finishes as a thread. */
function recordingModel(test: TestSetup, seen: string[]): void {
	const text = (content: unknown): string =>
		typeof content === "string"
			? content
			: Array.isArray(content)
				? content.map((part) => ((part as { type?: string }).type === "text" ? ((part as { text?: string }).text ?? "") : "")).join("")
				: "";
	const factory = (request: TranscriptContext) => {
		const last = request.messages.findLast((message) => message.role !== "system");
		const asked = text((last as { content?: unknown } | undefined)?.content);
		if (last?.role === "toolResult") return fauxAssistantMessage("Done.");
		seen.push(asked);
		if (asked.includes(THREAD_BRIEF)) {
			return fauxAssistantMessage([fauxToolCall("thread_finish", { summary: "Reviewed it: two notes." })], { stopReason: "toolUse" });
		}
		if (asked.includes(WORKER_BRIEF)) return fauxAssistantMessage("## Report\nOutcome: done\nFiles changed: none");
		return fauxAssistantMessage("Noted.");
	};
	test.faux.setResponses(Array.from({ length: 200 }, () => factory));
}

const T1 = "2026-11-08T09:00:00Z";
const T2 = "2026-11-08T10:00:00Z";
const T3 = "2026-11-08T11:00:00Z";

describe("event schedules", () => {
	eventTest("records what is open when it is created, fires only for later requests, and never twice", async () => {
		const github = new FakeGithub();
		github.request(PLATFORM, 10, { user: ME }, T1);
		const seen: string[] = [];
		const test = await setup({ githubReviews: { run: github.run } });
		recordingModel(test, seen);
		const client = await connect(test.server);
		const projectId = await addProject(client, test.projectDir);

		const saved = await saveSchedule(client, projectId, scheduleInput());
		expect(saved.nextRunAt).toBeNull();
		await test.server.scheduleEvents.poll();
		expect((await schedule(client, projectId, saved.id)).runs).toEqual([]);
		expect(await reviewTasks(client, projectId)).toEqual([]);

		// A new request fires once, however many polls look at it.
		github.request(PLATFORM, 11, { user: ME }, T2, "Add the cart page");
		await test.server.scheduleEvents.poll();
		await test.server.scheduleEvents.poll();
		const runs = await startedRuns(client, projectId, saved.id);
		expect(runs).toHaveLength(1);
		expect(runs[0]).toMatchObject({
			trigger: "event",
			at: "2026-11-08T10:00:00.000Z",
			ref: `https://github.com/${PLATFORM}/pull/11`,
			threadId: null,
		});
		expect(runs[0]!.workerId).not.toBeNull();
		expect(runs[0]!.workerId!.length).toBeLessThanOrEqual(48);

		// Its own task: a plain outcome, the PR URL in refs, and the worker's.
		const tasks = await reviewTasks(client, projectId);
		expect(tasks).toHaveLength(1);
		expect(tasks[0]).toMatchObject({
			title: "Review PR: Add the cart page",
			refs: [`https://github.com/${PLATFORM}/pull/11`],
			createdBy: "harness",
			scheduleId: null,
			status: "in_progress",
			workerIds: [runs[0]!.workerId!],
		});
		expect(runs[0]!.taskId).toBe(tasks[0]!.id);
		// An event schedule has no task of its own: one per event run, none on the schedule.
		expect((await schedule(client, projectId, saved.id)).taskId).toBeUndefined();

		// The worker got the user's brief plus the fixed event block.
		await until(() => seen.some((text) => text.includes(WORKER_BRIEF)));
		const brief = seen.find((text) => text.includes(WORKER_BRIEF))!;
		expect(brief.startsWith(WORKER_BRIEF)).toBe(true);
		expect(brief).toContain(`Pull request: https://github.com/${PLATFORM}/pull/11`);
		expect(brief).toContain("Title: Add the cart page");
		expect(brief).toContain("Base branch: main");
		expect(brief).toContain("Head branch: feature/11");
		expect(brief).toContain("Head commit: sha-11-0");
		expect(brief).toContain(`Review requested from: ${ME} (you)`);
		expect(brief).toContain("Requested at: 2026-11-08T10:00:00.000Z");
		expect(brief).toContain(
			"Nothing is posted to GitHub (no review, comment, approval or push) until the user explicitly approves it on the task.",
		);

		// New commits are not a request.
		github.push(PLATFORM, 11);
		github.push(PLATFORM, 10);
		await test.server.scheduleEvents.poll();
		expect(await startedRuns(client, projectId, saved.id)).toHaveLength(1);

		// A restart remembers what was handled: the same open requests fire nothing.
		const server = await test.restart();
		await server.scheduleEvents.poll();
		const after = await connect(server);
		expect((await after.hello()).type).toBe("hello");
		expect(await startedRuns(after, projectId, saved.id)).toHaveLength(1);
		expect(await reviewTasks(after, projectId)).toHaveLength(1);
		const file = JSON.parse(await readFile(join(test.dataDir, "projects", projectId, "schedule-events.json"), "utf8")) as {
			schedules: Record<string, { seen: Record<string, string> }>;
		};
		expect(Object.keys(file.schedules[saved.id]!.seen)).toHaveLength(2);
	});

	eventTest("fires again for a re-request, as a new run with its own task", async () => {
		const github = new FakeGithub();
		const test = await setup({ githubReviews: { run: github.run } });
		recordingModel(test, []);
		const client = await connect(test.server);
		const projectId = await addProject(client, test.projectDir);
		const saved = await saveSchedule(client, projectId, scheduleInput());
		await test.server.scheduleEvents.poll();

		github.request(PLATFORM, 20, { user: ME }, T1);
		await test.server.scheduleEvents.poll();
		expect(await startedRuns(client, projectId, saved.id)).toHaveLength(1);

		// The account reviewed, the author asked again: a new request event.
		github.clear(PLATFORM, 20, { user: ME });
		await test.server.scheduleEvents.poll();
		github.request(PLATFORM, 20, { user: ME }, T2);
		await test.server.scheduleEvents.poll();
		const runs = await startedRuns(client, projectId, saved.id);
		expect(runs).toHaveLength(2);
		expect(new Set(runs.map((run) => run.workerId)).size).toBe(2);
		expect(new Set(runs.map((run) => run.at)).size).toBe(2);
		expect(await reviewTasks(client, projectId)).toHaveLength(2);
	});

	eventTest("runs different pull requests at once and skips none of them", async () => {
		const github = new FakeGithub();
		const test = await setup({ githubReviews: { run: github.run } });
		recordingModel(test, []);
		const client = await connect(test.server);
		const projectId = await addProject(client, test.projectDir);
		const saved = await saveSchedule(client, projectId, scheduleInput());
		await test.server.scheduleEvents.poll();

		// Same second, three pull requests, while the first runs are still going.
		github.request(PLATFORM, 31, { user: ME }, T1);
		github.request(PLATFORM, 32, { user: ME }, T1);
		github.request(OTHER, 31, { user: ME }, T1);
		await test.server.scheduleEvents.poll();
		const runs = (await schedule(client, projectId, saved.id)).runs;
		expect(runs.filter((run) => run.outcome === "started")).toHaveLength(3);
		expect(runs.filter((run) => run.outcome === "skipped")).toHaveLength(0);
		expect(new Set(runs.map((run) => run.ref)).size).toBe(3);
		expect(new Set(runs.map((run) => run.workerId)).size).toBe(3);
		expect((await reviewTasks(client, projectId)).map((task) => task.refs[0]).sort()).toEqual([
			`https://github.com/${PLATFORM}/pull/31`,
			`https://github.com/${PLATFORM}/pull/32`,
			`https://github.com/${OTHER}/pull/31`,
		].sort());
	});

	eventTest("counts a request to the account's team, and ignores a team it is not in", async () => {
		const github = new FakeGithub();
		const test = await setup({ githubReviews: { run: github.run } });
		recordingModel(test, []);
		const client = await connect(test.server);
		const projectId = await addProject(client, test.projectDir);
		const saved = await saveSchedule(client, projectId, scheduleInput());
		await test.server.scheduleEvents.poll();

		github.request(PLATFORM, 41, { team: MY_TEAM }, T1);
		// Someone else's team and someone else: the search does not return these pull requests at all.
		github.request(PLATFORM, 42, { team: "acme/backend" }, T1);
		github.request(PLATFORM, 43, { user: "bob" }, T1);
		// The account's team on a pull request where another team and a person were asked first: the account's is meant.
		github.request(PLATFORM, 44, { user: "bob" }, T1);
		github.request(PLATFORM, 44, { team: "acme/backend" }, T2);
		github.request(PLATFORM, 44, { team: MY_TEAM }, T3);
		await test.server.scheduleEvents.poll();
		const runs = await startedRuns(client, projectId, saved.id);
		expect(runs.map((run) => run.ref).sort()).toEqual([
			`https://github.com/${PLATFORM}/pull/41`,
			`https://github.com/${PLATFORM}/pull/44`,
		]);
		expect(runs.find((run) => run.ref?.endsWith("/44"))?.at).toBe("2026-11-08T11:00:00.000Z");
	});

	eventTest("routes by the project's repositories, or by the schedule's own list", async () => {
		const github = new FakeGithub();
		const test = await setup({ githubReviews: { run: github.run } });
		recordingModel(test, []);
		const client = await connect(test.server);
		const projectId = await addProject(client, test.projectDir, [PLATFORM]);
		const byProject = await saveSchedule(client, projectId, scheduleInput({ title: "By project" }));
		const own = await saveSchedule(client, projectId, scheduleInput({ title: "Own", spec: { kind: "github-review-requested", repos: ["https://github.com/Acme/other-repo.git"] } }));
		expect((own.spec as { repos: string[] }).repos).toEqual(["Acme/other-repo"]);
		await test.server.scheduleEvents.poll();

		github.request(PLATFORM, 51, { user: ME }, T1);
		github.request(OTHER, 52, { user: ME }, T1);
		github.request("someone/else", 53, { user: ME }, T1);
		await test.server.scheduleEvents.poll();
		expect((await startedRuns(client, projectId, byProject.id)).map((run) => run.ref)).toEqual([`https://github.com/${PLATFORM}/pull/51`]);
		expect((await startedRuns(client, projectId, own.id)).map((run) => run.ref)).toEqual([`https://github.com/${OTHER}/pull/52`]);

		// With no repository anywhere it listens everywhere.
		const second = await setup({ githubReviews: { run: github.run } });
		recordingModel(second, []);
		const other = await connect(second.server);
		const otherProject = await addProject(other, second.projectDir);
		const everywhere = await saveSchedule(other, otherProject, scheduleInput({ title: "Everywhere" }));
		await second.server.scheduleEvents.poll();
		github.request("someone/else", 54, { user: ME }, T2);
		await second.server.scheduleEvents.poll();
		expect((await startedRuns(other, otherProject, everywhere.id)).map((run) => run.ref)).toEqual(["https://github.com/someone/else/pull/54"]);
	});

	eventTest("a failed poll fires nothing, shows its error, and the next poll catches up", async () => {
		const github = new FakeGithub();
		const test = await setup({ githubReviews: { run: github.run } });
		recordingModel(test, []);
		const client = await connect(test.server);
		const projectId = await addProject(client, test.projectDir);
		const saved = await saveSchedule(client, projectId, scheduleInput());
		await test.server.scheduleEvents.poll();
		expect((await schedule(client, projectId, saved.id)).eventState).toMatchObject({ error: null });
		expect((await schedule(client, projectId, saved.id)).eventState?.checkedAt).not.toBeNull();

		github.request(PLATFORM, 61, { user: ME }, T1);
		github.failure = "HTTP 502: Bad Gateway";
		await test.server.scheduleEvents.poll();
		let state = (await schedule(client, projectId, saved.id)).eventState;
		expect(state?.error).toContain("Bad Gateway");
		expect(await startedRuns(client, projectId, saved.id)).toEqual([]);
		expect(await reviewTasks(client, projectId)).toEqual([]);

		github.failure = null;
		await test.server.scheduleEvents.poll();
		state = (await schedule(client, projectId, saved.id)).eventState;
		expect(state?.error).toBeNull();
		expect(await startedRuns(client, projectId, saved.id)).toHaveLength(1);
	});

	eventTest("a missing gh is a failed poll too, and a poll with nothing enabled does not call gh at all", async () => {
		const github = new FakeGithub();
		let missing = false;
		const run: RunCommand = (command, args, options) =>
			missing ? Promise.resolve({ exitCode: null, stdout: "", stderr: "", missing: true }) : github.run(command, args, options);
		const test = await setup({ githubReviews: { run } });
		recordingModel(test, []);
		const client = await connect(test.server);
		const projectId = await addProject(client, test.projectDir);

		await test.server.scheduleEvents.poll();
		expect(github.searches).toBe(0);
		const paused = await saveSchedule(client, projectId, scheduleInput({ enabled: false }));
		await test.server.scheduleEvents.poll();
		expect(github.searches).toBe(0);

		missing = true;
		await saveSchedule(client, projectId, scheduleInput({ enabled: true }), paused.id);
		await test.server.scheduleEvents.poll();
		expect((await schedule(client, projectId, paused.id)).eventState?.error).toContain("gh is not installed");
	});

	eventTest("turning a schedule off and on again starts from a fresh baseline", async () => {
		const github = new FakeGithub();
		const test = await setup({ githubReviews: { run: github.run } });
		recordingModel(test, []);
		const client = await connect(test.server);
		const projectId = await addProject(client, test.projectDir);
		const saved = await saveSchedule(client, projectId, scheduleInput());
		await test.server.scheduleEvents.poll();

		await saveSchedule(client, projectId, scheduleInput({ enabled: false }), saved.id);
		await test.server.scheduleEvents.poll();
		github.request(PLATFORM, 71, { user: ME }, T1);
		await test.server.scheduleEvents.poll();
		await saveSchedule(client, projectId, scheduleInput({ enabled: true }), saved.id);
		await test.server.scheduleEvents.poll();
		expect(await startedRuns(client, projectId, saved.id)).toEqual([]);

		github.request(PLATFORM, 72, { user: ME }, T2);
		await test.server.scheduleEvents.poll();
		expect(await startedRuns(client, projectId, saved.id)).toHaveLength(1);
	});

	eventTest("a thread schedule's thread claims the task, and Run now handles what is unhandled, else the newest", async () => {
		const github = new FakeGithub();
		const seen: string[] = [];
		const test = await setup({ githubReviews: { run: github.run } });
		recordingModel(test, seen);
		const client = await connect(test.server);
		const projectId = await addProject(client, test.projectDir);
		const saved = await saveSchedule(client, projectId, scheduleInput({ kind: "thread", brief: THREAD_BRIEF, thinkingLevel: "low" }));
		await test.server.scheduleEvents.poll();

		// Nothing open: a skipped run, not an error.
		let response = await client.request({ type: "schedules.run", projectId, scheduleId: saved.id });
		if (response.type !== "schedules.run") throw errorOf(response);
		expect(response.run).toMatchObject({ trigger: "manual", outcome: "skipped", message: "no open review requests from you" });

		// Two requests the poll has not looked at yet: Run now runs both; the answer is the newest.
		github.request(PLATFORM, 81, { user: ME }, T1, "First");
		github.request(PLATFORM, 82, { user: ME }, T2, "Second");
		response = await client.request({ type: "schedules.run", projectId, scheduleId: saved.id });
		if (response.type !== "schedules.run") throw errorOf(response);
		expect(response.run).toMatchObject({ trigger: "manual", outcome: "started", ref: `https://github.com/${PLATFORM}/pull/82` });
		expect(response.run.threadId).not.toBeNull();
		expect(response.run.workerId).toBeNull();
		const tasks = await reviewTasks(client, projectId);
		expect(tasks.map((task) => task.title).sort()).toEqual(["Review PR: First", "Review PR: Second"]);
		const secondRun = response.run;
		const second = (await reviewTasks(client, projectId)).find((task) => task.title === "Review PR: Second")!;
		const listed = await client.request({ type: "threads.list", projectId, includeArchived: true });
		if (listed.type !== "threads.list") throw errorOf(listed);
		// The thread claimed the task for its work (a finished thread lets it go again), and started it.
		expect(listed.threads.find((entry) => entry.id === secondRun.threadId)).toMatchObject({ taskId: second.id, startedBy: "schedule", scheduleId: saved.id });
		expect(second.status).toBe("in_progress");
		expect(second.refs).toEqual([`https://github.com/${PLATFORM}/pull/82`]);
		await until(() => seen.filter((text) => text.includes(THREAD_BRIEF)).length === 2);
		expect(seen.find((text) => text.includes("Title: Second"))).toContain("Nothing is posted to GitHub");

		// The poll finds both handled.
		await test.server.scheduleEvents.poll();
		expect((await schedule(client, projectId, saved.id)).runs.filter((run) => run.outcome === "started")).toHaveLength(2);

		// Nothing unhandled: the newest open request runs again, as a new run with its own task.
		response = await client.request({ type: "schedules.run", projectId, scheduleId: saved.id });
		if (response.type !== "schedules.run") throw errorOf(response);
		expect(response.run).toMatchObject({ outcome: "started", ref: `https://github.com/${PLATFORM}/pull/82` });
		expect(await reviewTasks(client, projectId)).toHaveLength(3);
	});

	eventTest("an event rule is validated like any other, and the clock never looks at it", async () => {
		expect(validateSpec({ kind: "github-review-requested" }, "UTC")).toBeUndefined();
		expect(validateSpec({ kind: "github-review-requested", repos: ["acme/platform"] }, "UTC")).toBeUndefined();
		expect(validateSpec({ kind: "github-review-requested", repos: ["not a repo"] }, "UTC")).toContain("owner/name");
		const test = await setup({ githubReviews: { run: new FakeGithub().run } });
		const client = await connect(test.server);
		const projectId = await addProject(client, test.projectDir);
		const bad = await client.request({
			type: "schedules.save",
			projectId,
			schedule: scheduleInput({ spec: { kind: "github-review-requested", repos: ["nope"] } as ScheduleSpec }),
		});
		expect(bad.type).toBe("error");
		expect(test.server.features).toContain("schedule-events");
	});
});

describe("reading GitHub's answer", () => {
	const answer = (nodes: unknown[]): unknown => ({ data: { viewer: { login: ME }, search: { nodes } } });
	const node = (pending: unknown[], events: unknown[]): unknown => ({
		number: 5,
		url: "https://github.com/acme/app/pull/5",
		title: "T",
		isDraft: false,
		baseRefName: "main",
		headRefName: "f",
		headRefOid: "abc",
		repository: { nameWithOwner: "acme/app" },
		author: null,
		reviewRequests: { nodes: pending.map((requestedReviewer) => ({ requestedReviewer })) },
		timelineItems: { nodes: events },
	});
	const team = { __typename: "Team", slug: "ui", organization: { login: "acme" } };
	const event = (id: string, at: string, reviewer: unknown): unknown => ({ __typename: "ReviewRequestedEvent", id, createdAt: at, requestedReviewer: reviewer });

	it("falls back to a pending team request when the account's teams cannot be read", () => {
		const read = reviewRequestsFrom(answer([node([team], [event("e1", T1, team)])]), undefined);
		expect(read).toMatchObject({ ok: true });
		if (read.ok) expect(read.requests[0]).toMatchObject({ key: "acme/app#5@e1", requested: { kind: "team", name: "acme/ui" }, author: null });
		const known = reviewRequestsFrom(answer([node([team], [event("e1", T1, team)])]), ["acme/other"]);
		// Known teams that do not include it: the fallback still applies, since GitHub's search said a request matches.
		if (known.ok) expect(known.requests).toHaveLength(1);
	});

	it("ignores a request that is no longer pending and refuses an answer that is not the search", () => {
		const read = reviewRequestsFrom(answer([node([], [event("e1", T1, { __typename: "User", login: ME })])]), []);
		expect(read).toEqual({ ok: true, requests: [] });
		expect(reviewRequestsFrom({ errors: [{ message: "Bad credentials" }] }, [])).toEqual({ ok: false, message: "GitHub: Bad credentials" });
		expect(reviewRequestsFrom({ data: {} }, []).ok).toBe(false);
	});
});

describe("the run's text", () => {
	const request: ReviewRequest = {
		key: "acme/app#5@e1",
		repo: "acme/app",
		number: 5,
		url: "https://github.com/acme/app/pull/5",
		title: "Fix the cart",
		author: "alice",
		baseBranch: "main",
		headBranch: "fix/cart",
		headSha: "0123abc",
		draft: false,
		requestedAt: "2026-11-08T10:00:00.000Z",
		requested: { kind: "team", name: "acme/ui" },
	};

	it("appends the same block every time, naming the event and promising nothing is posted", () => {
		expect(eventBriefBlock(request)).toBe(
			[
				"---",
				"Event: a review was requested on a GitHub pull request.",
				"Pull request: https://github.com/acme/app/pull/5",
				"Repository: acme/app",
				"Number: 5",
				"Title: Fix the cart",
				"Author: alice",
				"Base branch: main",
				"Head branch: fix/cart",
				"Head commit: 0123abc",
				"Review requested from: team acme/ui",
				"Requested at: 2026-11-08T10:00:00.000Z",
				"Nothing is posted to GitHub (no review, comment, approval or push) until the user explicitly approves it on the task.",
			].join("\n"),
		);
	});

	it("derives run IDs from the schedule, the pull request and the request time", () => {
		const one = eventRunIdentity("review-requests-a1b2c3", request);
		expect(eventRunIdentity("review-requests-a1b2c3", request)).toEqual(one);
		expect(eventRunIdentity("review-requests-a1b2c3", { ...request, requestedAt: "2026-11-08T10:00:01.000Z" }).id).not.toBe(one.id);
		expect(eventRunIdentity("review-requests-a1b2c3", { ...request, number: 6 }).id).not.toBe(one.id);
		expect(eventRunIdentity("another-schedule", request).id).not.toBe(one.id);
		expect(eventRunIdentity("review-requests-a1b2c3", request, { rerunAt: 1 }).id).not.toBe(one.id);
		expect(one.id).toMatch(/^review-request-acme-app-5-[0-9a-f]{8}$/);
		const long = eventRunIdentity("x".repeat(60), { ...request, repo: `${"o".repeat(30)}/${"r".repeat(30)}`, number: 123456 });
		expect(long.id.length).toBeLessThanOrEqual(48);
		expect(long.id).toMatch(/^[a-z0-9][a-z0-9._-]*$/);
	});

	it("listens in the schedule's own repositories, else the project's, else everywhere", () => {
		expect(listenedRepos(["A/b"], ["c/d"])).toEqual(["a/b"]);
		expect(listenedRepos([], ["C/d", "c/d"])).toEqual(["c/d"]);
		expect(listenedRepos(undefined, [])).toEqual([]);
	});
});
