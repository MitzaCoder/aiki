/** Errors a client can raise, separate from protocol error responses. */
import type { ErrorCode, ErrorInfo, ErrorResponse } from "@kemiri/protocol";

export type ClientErrorCode = ErrorCode | "disconnected" | "timeout" | "closed" | "protocol";

export class ClientError extends Error {
	readonly code: ClientErrorCode;
	readonly data: unknown;

	constructor(code: ClientErrorCode, message: string, options?: { data?: unknown; cause?: unknown }) {
		super(message, options?.cause === undefined ? undefined : { cause: options.cause });
		this.name = "ClientError";
		this.code = code;
		this.data = options?.data;
	}
}

export function errorFromResponse(response: ErrorResponse): ClientError {
	const info: ErrorInfo = response.error;
	return new ClientError(info.code, info.message, { data: info.data });
}

export function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return "Unknown error";
}
