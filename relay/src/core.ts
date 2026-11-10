import { deleteAccount } from "./accounts";
import { quotaStatus } from "./quota-status";
import { reserveRequest, releaseRequest, chargeManagement, type RequestReservation } from "./budgets";
import { authenticatePhone } from "./admission";
import { deleteByCapability, deleteOwnedRoute } from "./delete";
import { createStore } from "./documents";
import { beginInstallation, confirmInstallation } from "./enrollment";
import { readAccountInventory, removeInstallation } from "./installations";
import { manageRoute } from "./routes";
import { readSendStatus, sendNotification } from "./send";
import type { CoreRequest, CoreResponse, Dependencies, RelayResponseBody } from "./ports";
import { RelayError, requireCondition } from "./validation";
export type { AuthPort, CoreRequest, CoreResponse, Dependencies, FcmMessage, FcmResult } from "./ports";
/** Build the HTTP-independent router; all state and external effects are supplied through explicit ports. */
export function createRelay(deps: Dependencies) {
	const store = createStore(deps.firestore);
	return async function handle(request: CoreRequest): Promise<CoreResponse> {
		let requestReservation: RequestReservation | undefined;
		const headers: Record<string, string> = {
			"Cache-Control": "no-store",
			"Content-Type": "application/json; charset=utf-8",
		};
		const setRetryAfter = (retryAt: number | undefined) => {
			if (retryAt !== undefined) headers["Retry-After"] = String(Math.max(1, Math.ceil((retryAt - deps.now()) / 1000)));
		};
		try {
			requireCondition(request.method === "POST", 405, "method_not_allowed");
			requireCondition(
				request.contentType?.split(";")[0].trim().toLowerCase() === "application/octet-stream",
				415,
				"unsupported_content_type",
			);
			requireCondition(request.path.startsWith("/v1/"), 404, "not_found");
			const path = request.path.slice("/v1/".length);
			requireCondition(!request.contentEncoding || request.contentEncoding === "identity", 415, "unsupported_encoding");
			requireCondition(Buffer.byteLength(request.body) <= (path === "send" ? 4096 : 8192), 413, "body_too_large");
			let input: unknown;
			try {
				input = JSON.parse(request.body);
			} catch {
				throw new RelayError(400, "invalid_request");
			}
			requireCondition(input !== null && typeof input === "object" && !Array.isArray(input));
			const deletion = ["delete", "routes/delete", "installations/delete", "accounts/delete"].includes(path);
			if (!deletion)
				requestReservation = await reserveRequest(
					deps,
					store,
					request.clientIp,
					[
						"send",
						"installations/begin",
						"installations/token/begin",
						"installations/confirm",
						"installations/token/confirm",
						"routes/create",
						"routes/renew",
						"routes/activate",
					].includes(path),
				);
			if (path === "send" || path === "send/status") {
				const result =
					path === "send"
						? await sendNotification(deps, store, request, input)
						: await readSendStatus(deps, store, request, input);
				if (result.externalAttempt && requestReservation) await releaseRequest(deps, store, requestReservation);
				setRetryAfter(result.retryAt);
				return { status: result.status, headers, body: result.body };
			}
			if (path === "delete") {
				await deleteByCapability(deps, store, request, input);
				return { status: 204, headers };
			}
			const known = [
				"accounts/status",
				"accounts/delete",
				"installations/list",
				"installations/delete",
				"installations/begin",
				"installations/confirm",
				"installations/token/begin",
				"installations/token/confirm",
				"routes/create",
				"routes/renew",
				"routes/activate",
				"routes/delete",
			];
			requireCondition(known.includes(path), 404, "not_found");
			const claims = await authenticatePhone(deps, request);
			const uid = claims.uid;
			if (path === "accounts/delete") {
				const result = await deleteAccount(deps, claims, input);
				setRetryAfter(result.retryAt);
				return { status: result.status, headers, body: result.body };
			}
			if (!deletion) await chargeManagement(deps, store, request.clientIp);
			let body: RelayResponseBody | undefined;
			switch (path) {
				case "accounts/status":
				case "installations/list":
					body = await readAccountInventory(deps, store, uid, input, path === "installations/list");
					if (path === "accounts/status") body.quotas = await quotaStatus(deps, store, uid, request.clientIp);
					break;
				case "installations/delete":
					await removeInstallation(deps, store, uid, input);
					break;
				case "installations/begin":
				case "installations/token/begin":
					body = await beginInstallation(deps, store, uid, input, path.includes("/token/"), request.clientIp);
					break;
				case "installations/confirm":
				case "installations/token/confirm":
					body = await confirmInstallation(deps, store, uid, input, path.includes("/token/"), request.clientIp);
					break;
				case "routes/delete":
					await deleteOwnedRoute(deps, store, uid, input);
					break;
				case "routes/create":
				case "routes/activate":
				case "routes/renew":
					body = await manageRoute(
						deps,
						store,
						uid,
						path.slice("routes/".length) as "create" | "activate" | "renew",
						input,
						request.clientIp,
					);
					break;
			}
			if (
				requestReservation &&
				![
					"accounts/status",
					"installations/list",
					"installations/begin",
					"installations/token/begin",
					"routes/create",
				].includes(path)
			) {
				await releaseRequest(deps, store, requestReservation);
			}
			return { status: body ? 200 : 204, headers, ...(body ? { body } : {}) };
		} catch (error) {
			const failure = error instanceof RelayError ? error : new RelayError(503, "relay_unavailable");
			setRetryAfter(failure.retryAt);
			return {
				status: failure.status,
				headers,
				body: { error: failure.code, ...(failure.retryAt !== undefined ? { retryAt: failure.retryAt } : {}) },
			};
		}
	};
}
