/**
 * Spots a `codemode` script that only wraps one tool call and returns all of its output, which costs more than the
 * direct call and clutters the chat, and tells the model so in the result it sees. Detection is deliberately
 * conservative: the script must be exactly one such pass-through statement (or `const r = await tools.x(...)` followed
 * by passing `r` or `r.output` on) and pi-durable's call details must show exactly one nested call that succeeded.
 */
import type { CodemodeToolDetails } from "@earendil-works/pi-durable/codemode";
import type { ToolExecutionResult, ToolRegistration, Wrap } from "@earendil-works/pi-durable";

export const ONE_CALL_SCRIPT_NOTE = "This script made one tool call and returned all of its output; call the tool directly next time.";

/** `code` with comments removed, leaving string and template literals untouched. */
function stripComments(code: string): string {
	let out = "";
	let quote: string | null = null;
	for (let i = 0; i < code.length; i++) {
		const char = code[i]!;
		if (quote !== null) {
			out += char;
			if (char === "\\") out += code[++i] ?? "";
			else if (char === quote) quote = null;
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			quote = char;
			out += char;
		} else if (char === "/" && code[i + 1] === "/") {
			while (i < code.length && code[i] !== "\n") i++;
			out += "\n";
		} else if (char === "/" && code[i + 1] === "*") {
			const end = code.indexOf("*/", i + 2);
			if (end === -1) return code;
			i = end + 1;
			out += " ";
		} else {
			out += char;
		}
	}
	return out;
}

/** Index just past the `)` matching the `(` right before `from`, or -1 when unbalanced or a template holds `${`. */
function endOfCall(code: string, from: number): number {
	let depth = 1;
	let quote: string | null = null;
	for (let i = from; i < code.length; i++) {
		const char = code[i]!;
		if (quote !== null) {
			if (char === "\\") i++;
			else if (quote === "`" && char === "$" && code[i + 1] === "{") return -1;
			else if (char === quote) quote = null;
			continue;
		}
		if (char === '"' || char === "'" || char === "`") quote = char;
		else if (char === "(" || char === "[" || char === "{") depth++;
		else if (char === ")" || char === "]" || char === "}") {
			depth--;
			if (depth === 0) return char === ")" ? i + 1 : -1;
		}
	}
	return -1;
}

const DIRECT = /^(text|console\.log)\(\s*await\s+tools\.[\w.]+\(/;
const DIRECT_RETURN = /^return\s+await\s+tools\.[\w.]+\(/;
const BOUND = /^(?:const|let)\s+(\w+)\s*=\s*await\s+tools\.[\w.]+\(/;

function escaped(name: string): string {
	return name.replace(/[$]/g, "\\$");
}

/** Whether the script's whole body is one tool call whose full output is returned or printed unchanged. */
export function isSingleCallPassThrough(code: string): boolean {
	const source = stripComments(code).trim();

	const direct = DIRECT.exec(source);
	if (direct !== null) {
		const end = endOfCall(source, direct[0].length);
		return end !== -1 && /^\s*\)\s*;?\s*$/.test(source.slice(end));
	}
	const directReturn = DIRECT_RETURN.exec(source);
	if (directReturn !== null) {
		const end = endOfCall(source, directReturn[0].length);
		return end !== -1 && /^\s*;?\s*$/.test(source.slice(end));
	}
	const bound = BOUND.exec(source);
	if (bound !== null) {
		const end = endOfCall(source, bound[0].length);
		if (end === -1) return false;
		const name = escaped(bound[1]!);
		const passes = new RegExp(`^\\s*;?\\s*(?:(?:text|console\\.log)\\(\\s*${name}(?:\\.output)?\\s*\\)|return\\s+${name}(?:\\.output)?)\\s*;?\\s*$`);
		return passes.test(source.slice(end));
	}
	return false;
}

/** The result with the note appended, when the script was a one-call pass-through. */
export function flagOneCallScript(code: string, result: ToolExecutionResult): ToolExecutionResult {
	if (result.isError === true || result.output === undefined) return result;
	const calls = (result.details as CodemodeToolDetails | undefined)?.calls;
	if (calls === undefined || calls.length !== 1 || calls[0]!.status !== "ok") return result;
	if (!isSingleCallPassThrough(code)) return result;
	return { ...result, output: [...result.output, { type: "text", text: `\n\n${ONE_CALL_SCRIPT_NOTE}` }] };
}

/** Wraps the `codemode` tool so its result carries the note. */
export const flagOneCallScriptWrap: Wrap = {
	tool: "codemode",
	wrap: (tool: ToolRegistration): ToolRegistration => ({
		...tool,
		async execute(args, api, context) {
			const result = await tool.execute(args, api, context);
			const code = (args as { code?: unknown }).code;
			return typeof code === "string" ? flagOneCallScript(code, result) : result;
		},
	}),
};
