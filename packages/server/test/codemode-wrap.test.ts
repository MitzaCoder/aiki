import { describe, expect, it } from "bun:test";
import { flagOneCallScript, isSingleCallPassThrough, ONE_CALL_SCRIPT_NOTE } from "../src/codemode-wrap.ts";

const call = (status: "ok" | "error" = "ok") => ({ id: 1, name: "bash", args: "{}", status });
const result = (calls: ReturnType<typeof call>[], isError = false) => ({
	output: [{ type: "text" as const, text: "Script completed\nOutput:\nhi" }],
	isError,
	details: { calls },
});

describe("isSingleCallPassThrough", () => {
	it.each([
		'text(await tools.bash({ command: "ls" }))',
		'text(await tools.bash({ command: "echo (hi)" }));',
		'return await tools.read({ path: "a.ts" })',
		'console.log(await tools.bash({\n  command: "ls",\n}))',
		'// list files\ntext(await tools.bash({ command: "ls" })) // done',
		'const r = await tools.bash({ command: "ls" });\ntext(r.output);',
		'const r = await tools.read({ path: "a" });\nreturn r;',
		'text(await tools.workers.list({}))',
	])("flags %j", (code) => {
		expect(isSingleCallPassThrough(code)).toBe(true);
	});

	it.each([
		'const r = await tools.bash({ command: "ls" });\ntext(r.output.split("\\n").slice(0, 5).join("\\n"))',
		'const r = await tools.bash({ command: "ls" });\ntext(r.exitCode)',
		'text((await tools.bash({ command: "ls" })).output.slice(0, 100))',
		'text(await tools.bash({ command: "ls" }));\ntext(await tools.read({ path: "a" }))',
		'const [a, b] = await Promise.all([tools.bash({ command: "ls" }), tools.read({ path: "a" })]);',
		'await Promise.all([tools.bash({ command: "ls" })])',
		'for (const p of ["a"]) text(await tools.read({ path: p }))',
		'text(await tools.bash({ command: `echo ${x}` }))',
		'const r = await tools.bash({ command: "ls" });\ntext(r.output);\ntext("extra")',
		"",
	])("does not flag %j", (code) => {
		expect(isSingleCallPassThrough(code)).toBe(false);
	});
});

describe("flagOneCallScript", () => {
	const wrap = 'text(await tools.bash({ command: "ls" }))';

	it("appends the note for a single wrapped call", () => {
		const flagged = flagOneCallScript(wrap, result([call()]));
		expect(flagged.output?.at(-1)).toEqual({ type: "text", text: `\n\n${ONE_CALL_SCRIPT_NOTE}` });
	});

	it("leaves two or more calls alone", () => {
		const two = result([call(), { ...call(), id: 2 }]);
		expect(flagOneCallScript(wrap, two)).toBe(two);
	});

	it("leaves a filtering script alone", () => {
		const filtered = result([call()]);
		expect(flagOneCallScript('const r = await tools.bash({ command: "ls" });\ntext(r.output.slice(0, 10))', filtered)).toBe(filtered);
	});

	it("leaves a Promise.all of one call alone", () => {
		const parallel = result([call()]);
		expect(flagOneCallScript('const [r] = await Promise.all([tools.bash({ command: "ls" })]); text(r.output)', parallel)).toBe(parallel);
	});

	it("leaves a failed script or call alone", () => {
		const failedScript = result([call()], true);
		expect(flagOneCallScript(wrap, failedScript)).toBe(failedScript);
		const failedCall = result([call("error")]);
		expect(flagOneCallScript(wrap, failedCall)).toBe(failedCall);
	});
});
