import { expect, test } from "bun:test";
import { join } from "node:path";

/** Separate process: durable tokens must be registered only after installation configuration is loaded. */
test("a configured durable namespace retains board and worker defaults through restart", async () => {
	const script = `
		import { createSetup, TestClient } from ${JSON.stringify(join(import.meta.dir, "support.ts"))};
		import { BoardDoc } from ${JSON.stringify(join(import.meta.dir, "../src/board.ts"))};
		import { WorkersDoc } from ${JSON.stringify(join(import.meta.dir, "../src/workers.ts"))};
		import { ThreadsDoc } from ${JSON.stringify(join(import.meta.dir, "../src/threads.ts"))};
		import { AttachedFoldersDoc } from ${JSON.stringify(join(import.meta.dir, "../src/folder-context.ts"))};
		for (const token of [BoardDoc, WorkersDoc, ThreadsDoc, AttachedFoldersDoc]) {
			if (!token.definition.kind.startsWith('previous.')) throw new Error('storage namespace changed');
		}
		const setup = await createSetup();
		let client = await TestClient.open(setup.server);
		const request = async (body) => { const response = await client.request(body); if (response.type === 'error') throw new Error(JSON.stringify(response)); return response; };
		try {
			await client.hello();
			const { project } = await request({ type: 'projects.add', path: setup.projectDir });
			await request({ type: 'projects.configure', projectId: project.id, coordinatorModel: { provider:'faux', modelId:'faux-1' }, coordinatorThinkingLevel:'low' });
			await request({ type: 'board.task.save', projectId: project.id, task: { title:'Retained task', description:'Synthetic compatibility fixture', acceptance:null, status:'todo', blockedBy:[], blockedReason:null, writeScopes:[] } });
			await request({ type: 'workers.defaults.set', projectId: project.id, defaults:{ model:{provider:'faux',modelId:'faux-1'}, thinkingLevel:'low' } });
			client.close(); await setup.restart(); client = await TestClient.open(setup.server); await client.hello();
			const board = await request({ type: 'board.get', projectId: project.id });
			if (board.board.tasks[0]?.title !== 'Retained task') throw new Error('board data lost');
			const workers = await request({ type: 'workers.list', projectId: project.id });
			if (workers.defaults.model?.modelId !== 'faux-1') throw new Error('worker defaults lost');
			console.log('durable state retained');
		} finally { client.close(); await setup.cleanup(); }
	`;
	const child = Bun.spawn([process.execPath, "-e", script], {
		env: { ...process.env, KEMIRI_STATE_NAMESPACE: "previous", KEMIRI_CONTEXT_EXTENSION: "previous-context", KEMIRI_PROJECT_CONTEXT_DIR: ".previous" },
		stdout: "pipe", stderr: "pipe",
	});
	const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
	expect(stderr).toBe("");
	expect(code).toBe(0);
	expect(stdout).toContain("durable state retained");
}, 20_000);
