/** Errors that become a protocol `error` response with a stable code. */
import type { ErrorCode } from "@kemiri/protocol";

export class ServerError extends Error {
	readonly code: ErrorCode;
	readonly data: unknown;

	constructor(code: ErrorCode, message: string, data?: unknown) {
		super(message);
		this.name = "ServerError";
		this.code = code;
		this.data = data;
	}
}

/** A message safe to log or send: never includes a credential value. */
export function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}
