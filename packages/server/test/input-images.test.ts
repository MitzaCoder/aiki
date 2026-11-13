/** Images in a message: one that keeps to the limits reaches the model, one that breaks them is refused. */
import { afterEach, describe, expect, it } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import { INPUT_IMAGE_MAX_BYTES, INPUT_MAX_IMAGES } from "@kemiri/protocol";
import { TestClient, ViewClient, createSetup, entryText, type TestSetup } from "./support.ts";

const cleanups: (() => Promise<void>)[] = [];
const clients: TestClient[] = [];

afterEach(async () => {
	for (const client of clients.splice(0)) client.close();
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");

function image(bytes = PNG, mimeType = "image/png"): { type: "image"; data: string; mimeType: string } {
	return { type: "image", data: bytes.toString("base64"), mimeType };
}

async function open(): Promise<{ test: TestSetup; client: TestClient; projectId: string }> {
	const test = await createSetup();
	cleanups.push(test.cleanup);
	const client = await TestClient.open(test.server);
	clients.push(client);
	await client.hello();
	const added = await client.request({ type: "projects.add", path: test.projectDir });
	if (added.type !== "projects.add") throw new Error(JSON.stringify(added));
	await client.request({
		type: "projects.configure",
		projectId: added.project.id,
		coordinatorModel: { provider: "faux", modelId: "faux-1" },
		coordinatorThinkingLevel: "low",
	});
	return { test, client, projectId: added.project.id };
}

describe("images in a message", () => {
	it("hands several images, with no text, to the model", async () => {
		const { test, client, projectId } = await open();
		const view = new ViewClient(client);
		await view.start(projectId);
		test.faux.setResponses([
			(context) => {
				const last = context.messages.at(-1);
				const blocks = last?.role === "user" && Array.isArray(last.content) ? last.content : [];
				return fauxAssistantMessage(`saw ${blocks.filter((block) => block.type === "image").length} images`);
			},
		]);
		const answer = await client.request({
			type: "conversation.submit",
			projectId,
			requestId: "pics",
			content: [image(), image(Buffer.from("GIF89a"), "image/gif")],
		});
		expect(answer.type).toBe("conversation.submit");
		await view.waitForView((value) => value.entries.some((entry) => entryText(entry) === "saw 2 images"));
	});

	it("refuses a type, a size and a count over the limits", async () => {
		const { client, projectId } = await open();
		const submit = (content: unknown[]) =>
			client.request({ type: "conversation.submit", projectId, requestId: `r-${Math.random()}`, content } as never);
		expect(await submit([image(PNG, "image/bmp")])).toMatchObject({ type: "error", error: { code: "bad_request" } });
		expect(await submit([image(Buffer.alloc(INPUT_IMAGE_MAX_BYTES + 1))])).toMatchObject({ type: "error", error: { code: "bad_request" } });
		expect(await submit(Array.from({ length: INPUT_MAX_IMAGES + 1 }, () => image()))).toMatchObject({ type: "error", error: { code: "bad_request" } });
		// Four 5 MiB images and one more MiB are over the total, yet still inside the WebSocket frame.
		const four = Array.from({ length: 4 }, () => image(Buffer.alloc(INPUT_IMAGE_MAX_BYTES)));
		expect(await submit([...four, image(Buffer.alloc(1024 * 1024))])).toMatchObject({
			type: "error",
			error: { code: "bad_request" },
		});
	});
});
