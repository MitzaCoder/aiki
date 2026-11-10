/**
 * A stand-in aiki backend for the deploy tests: one WebSocket at `/ws` that answers `hello`, `server.status`,
 * `server.drain`, `projects.list` and `conversation.page`, and records what was asked. No storage, no harness, no repository imports.
 *
 * Its answers are read live from the mutable `state` or from files, so a test can make it busy, publish a release under
 * a deploy root or lie about the running commit between two checks of the same deploy.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type FakeRelease = { name: string; commit: string; description: string; deployedAt: string };

export type FakeBackendState = {
	/** false answers `server.status` with unknown_request, like a server that lists the feature before implementing it. */
	answerStatus: boolean;
	/** `hello.features`; null leaves the field out, as servers older than it do. */
	features: readonly string[] | null;
	/** `server.status.release`, when neither file nor deploy root is set. */
	release: FakeRelease | null;
	/** When set, `server.status` reports the commit of `<deployRoot>/current/RELEASE.json`, like a real backend. */
	deployRoot: string | null;
	/** When set, `server.status` reports the release in this JSON file instead (a "stale" commit, for rollbacks). */
	releaseFromFile: string | null;
	/** The `busy` counts answered now. */
	busy: { conversations: number; workers: number };
	/** How many `server.status` answers still report `busy` before it turns idle; null reports it forever. */
	busyFor: number | null;
	/** false answers `server.drain` with unknown_request, like a server that lists `drain` before implementing it. */
	answerDrain: boolean;
	/** The tool calls executing now, as `server.drain` and `busy.toolCalls` report them. */
	toolCalls: number;
	/** How many `server.drain` answers still report `toolCalls` before it turns 0; null reports it forever. */
	toolCallsFor: number | null;
	projects: { id: string; state: string }[];
	/**
	 * How many `projects.list` answers still report a project's state as given; null never changes it. A number models
	 * projects opening lazily: they are listed, but closed until something pages them.
	 */
	openFor: number | null;
	/** IDs of projects whose `conversation.page` answers with an error. */
	failPageFor: string[];
};

export type FakeBackend = {
	url: string;
	state: FakeBackendState;
	/** Every request received, in order, without its id; `at` is for ordering against a restart. */
	requests: { type: string; fields: Record<string, unknown>; at: number }[];
	stop(): void;
};

export const ALL_FEATURES = [
	"projects",
	"filesystem",
	"models",
	"credentials",
	"logins",
	"conversation",
	"workers",
	"context",
	"server-status",
];

/** A server that drains: everything above plus `drain`. */
export const DRAIN_FEATURES = [...ALL_FEATURES, "drain"];

function readJson<T>(path: string): T | null {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch {
		return null;
	}
}

function currentRelease(state: FakeBackendState): FakeRelease | null {
	if (state.releaseFromFile) return readJson<FakeRelease>(state.releaseFromFile);
	if (state.deployRoot) return readJson<FakeRelease>(join(state.deployRoot, "current", "RELEASE.json"));
	return state.release;
}

function listedProjects(state: FakeBackendState): { id: string; state: string }[] {
	if (state.openFor === null) return state.projects;
	if (state.openFor > 0) {
		state.openFor -= 1;
		return state.projects;
	}
	return state.projects.map((project) => ({ ...project, state: "closed" }));
}

function currentBusy(state: FakeBackendState): { conversations: number; workers: number } {
	if (state.busyFor === null) return state.busy;
	if (state.busyFor <= 0) return { conversations: 0, workers: 0 };
	state.busyFor -= 1;
	return state.busy;
}

function currentToolCalls(state: FakeBackendState): number {
	if (state.toolCallsFor === null) return state.toolCalls;
	if (state.toolCallsFor <= 0) return 0;
	state.toolCallsFor -= 1;
	return state.toolCalls;
}

export function startFakeBackend(overrides: Partial<FakeBackendState> = {}): FakeBackend {
	const state: FakeBackendState = {
		answerStatus: true,
		features: ALL_FEATURES,
		release: null,
		deployRoot: null,
		releaseFromFile: null,
		busy: { conversations: 0, workers: 0 },
		busyFor: null,
		answerDrain: true,
		toolCalls: 0,
		toolCallsFor: null,
		projects: [],
		openFor: null,
		failPageFor: [],
		...overrides,
	};
	const requests: FakeBackend["requests"] = [];

	const server = Bun.serve({
		port: 0,
		fetch(request, listener) {
			if (new URL(request.url).pathname !== "/ws") return new Response("not found", { status: 404 });
			return listener.upgrade(request) ? undefined : new Response("no websocket", { status: 400 });
		},
		websocket: {
			message(socket, raw) {
				const request = JSON.parse(String(raw)) as Record<string, unknown>;
				const type = String(request.type);
				const { type: _type, id, ...fields } = request;
				requests.push({ type, fields, at: Date.now() });
				const answer = (body: Record<string, unknown>): void => {
					socket.send(JSON.stringify({ type, id, ...body }));
				};
				const fail = (code: string, text: string): void => {
					socket.send(JSON.stringify({ type: "error", id, error: { code, message: text } }));
				};

				switch (type) {
					case "hello":
						answer({
							protocolVersion: 1,
							server: { name: "aiki", version: "0.1.0" },
							...(state.features === null ? {} : { features: state.features }),
						});
						return;
					case "server.status":
						if (!state.answerStatus) return fail("unknown_request", 'This server does not know "server.status"');
						answer({
							status: {
								release: currentRelease(state),
								deploy: null,
								busy: currentBusy(state),
								startedAt: new Date().toISOString(),
							},
						});
						return;
					case "server.drain":
						if (!state.answerDrain) return fail("unknown_request", 'This server does not know "server.drain"');
						answer({ drainingUntil: new Date(Date.now() + 120_000).toISOString(), toolCalls: currentToolCalls(state) });
						return;
					case "projects.list":
						answer({
							projects: listedProjects(state).map((project) => ({
								...project,
								name: project.id,
								path: "/tmp",
							})),
						});
						return;
					case "conversation.page": {
						const projectId = String(fields.projectId);
						if (state.failPageFor.includes(projectId)) return fail("harness_failed", `${projectId} cannot be paged`);
						answer({ entries: [] });
						return;
					}
					default:
						fail("unknown_request", `no such request: ${type}`);
				}
			},
		},
	});

	return { url: `http://127.0.0.1:${server.port}`, state, requests, stop: () => server.stop(true) };
}
