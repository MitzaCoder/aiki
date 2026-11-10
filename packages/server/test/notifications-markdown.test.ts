import { expect, test } from "bun:test";
import { boardQuestionNotification } from "../src/notifications.ts";

test("question and warning notifications strip complete Markdown before limiting the plain text", () => {
	for (const warning of [false, true]) {
		const event = boardQuestionNotification({ projectId: "demo", projectName: "Demo", questionId: "Q1", warning,
			text: "**Choose:**\n\n- Run `checks`\n  - Read [guide](https://example.com/guide)" });
		expect(event.body).toBe("Choose: Run checks Read guide");
	}
});
