import { DEFAULT_DATABASE_ID, requireDatabaseId } from "../src/database";
import { DEFAULT_LIMITS, type LimitName } from "../src/limits";

export type OperatorCommand =
	| { action: "status" | "seed-control" | "pause" | "resume" | "reconcile" }
	| { action: "enrollment"; open: boolean }
	| { action: "limits"; name: LimitName; value: number }
	| { action: "account"; operation: "disable" | "enable" | "delete"; uid: string }
	| { action: "phone"; installationId: string };
export interface OperatorArguments {
	emulator: boolean;
	projectId: string;
	databaseId: string;
	yes: boolean;
	command: OperatorCommand;
}
export class OperatorArgumentsError extends Error {}
function invalid(): never {
	throw new OperatorArgumentsError("invalid_operator_arguments");
}
function uid(input: string | undefined): string {
	if (!input || input.length > 128 || /[\/\u0000-\u001f\u007f]/.test(input) || input === "." || input === "..")
		invalid();
	return input;
}
/** Reject ambiguous targets and syntax before any SDK initialization or credential discovery. */
export function operatorArguments(args: string[], environment: Record<string, string | undefined>): OperatorArguments {
	const flags = new Map<string, string | true>();
	const words: string[] = [];
	for (let index = 0; index < args.length; index++) {
		const word = args[index];
		if (!word.startsWith("--")) {
			words.push(word);
			continue;
		}
		if (flags.has(word)) invalid();
		if (["--yes", "--emulator", "--confirm-real-project"].includes(word)) flags.set(word, true);
		else if (["--project", "--database"].includes(word)) {
			const value = args[++index];
			if (!value || value.startsWith("--")) invalid();
			flags.set(word, value);
		} else invalid();
	}
	const emulator = flags.has("--emulator");
	const projectId = String(flags.get("--project") ?? (emulator ? "demo-aiki-relay" : ""));
	if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) invalid();
	if (emulator) {
		if (!projectId.startsWith("demo-") || flags.has("--confirm-real-project")) invalid();
	} else {
		if (!flags.has("--confirm-real-project") || projectId.startsWith("demo-")) invalid();
		// Even an empty emulator variable is contamination, including emulators not used by this package.
		if (
			Object.keys(environment).some(
				(name) =>
					name.includes("EMULATOR") ||
					/^RELAY_.*_PORT$/.test(name) ||
					["RELAY_APP_CHECK_BYPASS", "RELAY_DEMO_STATE", "RELAY_OPERATOR_INTERNAL"].includes(name),
			)
		) {
			throw new OperatorArgumentsError("real_project_refused_with_emulator_variables");
		}
	}
	let databaseId: string;
	try {
		databaseId = requireDatabaseId(String(flags.get("--database") ?? DEFAULT_DATABASE_ID));
	} catch {
		throw new OperatorArgumentsError("invalid_database_id");
	}
	const [action, first, second] = words;
	let command: OperatorCommand;
	if (["status", "seed-control", "pause", "resume", "reconcile"].includes(action) && words.length === 1) {
		command = { action: action as "status" | "seed-control" | "pause" | "resume" | "reconcile" };
	} else if (action === "enrollment" && words.length === 2 && ["open", "close"].includes(first)) {
		command = { action, open: first === "open" };
	} else if (action === "limits" && words.length === 4 && first === "set") {
		const value = Number(words[3]);
		if (!Object.hasOwn(DEFAULT_LIMITS, second) || !/^(0|[1-9]\d*)$/.test(words[3]) || !Number.isSafeInteger(value))
			invalid();
		command = { action, name: second as LimitName, value };
	} else if (action === "account" && words.length === 3 && ["disable", "enable", "delete"].includes(first)) {
		command = { action, operation: first as "disable" | "enable" | "delete", uid: uid(second) };
	} else if (action === "phone" && words.length === 3 && first === "disable" && /^[A-Za-z0-9_-]{22}$/.test(second)) {
		command = { action, installationId: second };
	} else invalid();
	return { emulator, projectId, databaseId, yes: flags.has("--yes"), command };
}

/** Plans expose the selected project/database and change, never the supplied UID or installation ID. */
export function operatorPlan(args: OperatorArguments) {
	const command = args.command;
	const operation =
		command.action === "account"
			? `account ${command.operation}`
			: command.action === "phone"
				? "phone disable"
				: command.action === "enrollment"
					? `enrollment ${command.open ? "open" : "close"}`
					: command.action === "limits"
						? `limits set ${command.name} ${command.value}`
						: command.action;
	const effects: Record<OperatorCommand["action"], string> = {
		status: "Read switches, effective limits, reserved capacity and today's global counters; no change",
		"seed-control": "Create settings paused with enrollment closed; fail if settings already exist",
		pause: "Pause relay sends/challenges/routes/enrollment; keep deletion available; cannot recall in-flight FCM",
		resume: "Enable relay operations, without opening enrollment or resetting counters",
		enrollment: "Change new relay-account/phone admission only, not Firebase Auth signup/email",
		limits: "Replace one limit without resetting counters",
		account:
			command.action === "account" && command.operation === "delete"
				? "Block supplied account, durably erase its relay state and delete the project-wide Auth user; resume pending work"
				: command.action === "account" && command.operation === "enable"
					? "Re-enable supplied fully cleaned disabled Auth/relay account; restore no phone/route"
					: "Block supplied account, disable/revoke Auth and durably erase phones/routes; retain abuse counters",
		phone: "Remove supplied phone and its routes/token; preserve other phones and abuse counters",
		reconcile: "Repair all relay Auth/expiry state and resume durable cleanup, including queued Auth deletion",
	};
	return {
		mode: args.emulator ? "emulator" : "real",
		projectId: args.projectId,
		databaseId: args.databaseId,
		operation,
		effect: effects[command.action],
		apply: args.yes,
	};
}
