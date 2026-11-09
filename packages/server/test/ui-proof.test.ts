/** "Show UI changes" (`uiProof`): the default, persistence, and the prompt paragraph per value. */
import { afterEach, describe, expect, it } from "bun:test";
import { DEFAULT_CHECK_INS, type ProjectSummary, type UiProof } from "@mihai-harness/protocol";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Project } from "../src/projects.ts";
import { coordinatorSection, threadCoordinatorSection, uiProofParagraph, workerInstructions } from "../src/workers.ts";
import { createSetup, errorOf, TestClient, type TestSetup } from "./support.ts";

const cleanups: (() => Promise<void>)[] = [];
const clients: TestClient[] = [];

afterEach(async () => {
	for (const client of clients.splice(0)) client.close();
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function setup(): Promise<{ test: TestSetup; client: TestClient; projectId: string }> {
	const test = await createSetup();
	cleanups.push(test.cleanup);
	const client = await TestClient.open(test.server);
	clients.push(client);
	await client.hello();
	const added = await client.request({ type: "projects.add", path: test.projectDir });
	if (added.type !== "projects.add") throw errorOf(added);
	return { test, client, projectId: added.project.id };
}

async function listed(client: TestClient, projectId: string): Promise<ProjectSummary> {
	const response = await client.request({ type: "projects.list" });
	if (response.type !== "projects.list") throw errorOf(response);
	return response.projects.find((project) => project.id === projectId) as ProjectSummary;
}

async function configure(client: TestClient, projectId: string, uiProof: UiProof | null): Promise<ProjectSummary> {
	const response = await client.request({ type: "projects.configure", projectId, uiProof });
	if (response.type !== "projects.configure") throw errorOf(response);
	return response.project;
}

function project(uiProof: UiProof): Project {
	return {
		version: 1,
		id: "proj",
		name: "Demo",
		path: "/repo",
		createdAt: new Date(0).toISOString(),
		coordinator: { model: null, thinkingLevel: null },
		workerModels: [],
		checkIns: { ...DEFAULT_CHECK_INS },
		longPromptCache: "coordinators",
		keepPromptCacheWarm: true,
		promptCacheWarmHours: 8,
		uiProof,
		links: null,
	};
}

const worker = (p: Project): string =>
	workerInstructions({ id: "w", title: "t", project: p, cwd: "/repo", isolation: "shared" });

describe("the setting", () => {
	it("is screenshots-and-videos for a new project, advertised as a feature", async () => {
		const { test, client, projectId } = await setup();
		expect((await listed(client, projectId)).uiProof).toBe("screenshots-and-videos");
		const fresh = await TestClient.open(test.server);
		clients.push(fresh);
		const hello = await fresh.hello();
		if (hello.type !== "hello") throw errorOf(hello);
		expect(hello.features).toContain("ui-proof");
	});

	it("persists a change across a restart, and null restores the default", async () => {
		const { test, client, projectId } = await setup();
		expect((await configure(client, projectId, "screenshots")).uiProof).toBe("screenshots");
		const file = join(test.dataDir, "projects", projectId, "project.json");
		expect(JSON.parse(await readFile(file, "utf8")).uiProof).toBe("screenshots");

		const server = await test.restart();
		const again = await TestClient.open(server);
		clients.push(again);
		await again.hello();
		expect((await listed(again, projectId)).uiProof).toBe("screenshots");

		expect((await configure(again, projectId, "off")).uiProof).toBe("off");
		expect((await configure(again, projectId, null)).uiProof).toBe("screenshots-and-videos");
	});

	it("gives a project saved before the setting, or with an unknown value, the default", async () => {
		const { test, client, projectId } = await setup();
		const file = join(test.dataDir, "projects", projectId, "project.json");
		const stored = JSON.parse(await readFile(file, "utf8"));
		delete stored.uiProof;
		await writeFile(file, JSON.stringify(stored));
		let again = await TestClient.open(await test.restart());
		clients.push(again);
		await again.hello();
		expect((await listed(again, projectId)).uiProof).toBe("screenshots-and-videos");

		await writeFile(file, JSON.stringify({ ...stored, uiProof: "everything" }));
		again = await TestClient.open(await test.restart());
		clients.push(again);
		await again.hello();
		expect((await listed(again, projectId)).uiProof).toBe("screenshots-and-videos");
	});
});

describe("the prompt rule", () => {
	it("adds the coordinator paragraph, with videos, to main and to a thread", () => {
		for (const text of [coordinatorSection(project("screenshots-and-videos")), threadCoordinatorSection(project("screenshots-and-videos"))]) {
			expect(text).toContain("Any change a user can see in a UI");
			expect(text).toContain("For a bug, show it before and after");
			expect(text).toContain("plus a short screen recording of the interaction");
			expect(text).toContain("Put this rule in every worker brief");
			expect(text).toContain("keep it in project memory");
			expect(text).toContain("artifact_save");
		}
	});

	it("drops the recording with screenshots", () => {
		const text = coordinatorSection(project("screenshots"));
		expect(text).toContain("Use before/after screenshots.");
		expect(text).not.toContain("screen recording");
		expect(worker(project("screenshots"))).not.toContain("screen recording");
	});

	it("adds the worker paragraph, without the coordinator's duties", () => {
		const text = worker(project("screenshots-and-videos"));
		expect(text).toContain("is proven before you report");
		expect(text).toContain("plus a short screen recording of the interaction");
		expect(text).not.toContain("Put this rule in every worker brief");
		expect(text).not.toContain("project memory, so later workers");
	});

	it("adds nothing when off", () => {
		expect(uiProofParagraph(project("off"), "coordinator")).toBe("");
		for (const text of [coordinatorSection(project("off")), threadCoordinatorSection(project("off")), worker(project("off"))]) {
			expect(text).not.toContain("a user can see in a UI");
			expect(text).not.toContain("\n\n\n\n");
		}
	});

	it("is the same text on every build with the same setting", () => {
		for (const value of ["off", "screenshots", "screenshots-and-videos"] as const) {
			expect(coordinatorSection(project(value))).toBe(coordinatorSection(project(value)));
			expect(worker(project(value))).toBe(worker(project(value)));
		}
	});
});
