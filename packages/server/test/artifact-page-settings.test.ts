import { expect, test } from "bun:test";
import { createSetup, TestClient } from "./support.ts";

test("artifact request policy is off by default, persists per project, and null resets it", async () => {
	const setup = await createSetup({ terminals: false });
	let client = await TestClient.open(setup.server);
	try {
		await client.hello();
		const added = await client.request({ type: "projects.add", path: setup.projectDir });
		if (added.type !== "projects.add") throw new Error(added.type);
		const projectId = added.project.id;
		expect(added.project.blockArtifactRequests).toBe(false);
		const changed = await client.request({ type: "projects.configure", projectId, blockArtifactRequests: true });
		if (changed.type !== "projects.configure") throw new Error(changed.type);
		expect(changed.project.blockArtifactRequests).toBe(true);
		client.close(); await setup.restart(); client = await TestClient.open(setup.server); await client.hello();
		const listed = await client.request({ type: "projects.list" });
		if (listed.type !== "projects.list") throw new Error(listed.type);
		expect(listed.projects.find((project) => project.id === projectId)?.blockArtifactRequests).toBe(true);
		const reset = await client.request({ type: "projects.configure", projectId, blockArtifactRequests: null });
		if (reset.type !== "projects.configure") throw new Error(reset.type);
		expect(reset.project.blockArtifactRequests).toBe(false);
	} finally { client.close(); await setup.cleanup(); }
});
