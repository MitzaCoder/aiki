import type { AccountDocument, ActiveAccountDocument, InstallationDocument, RouteDocument } from "./documents";
import type { CoreRequest, Dependencies, IdentityClaims } from "./ports";
import { RelayError, requireCondition } from "./validation";
/** Fail closed on missing, disabled or deleting relay account state. */
export function requireActiveAccount(account: AccountDocument | undefined): asserts account is ActiveAccountDocument {
	requireCondition(account, 403, "account_disabled");
	requireCondition(
		account.state === "active",
		account.state === "deleting" ? 410 : 403,
		account.state === "deleting" ? "account_deleted" : "account_disabled",
	);
}
/** Consult Auth without a positive cache before every challenge or external send. */
export async function requireLiveAuthUser(deps: Dependencies, uid: string): Promise<void> {
	try {
		requireCondition(!(await deps.auth.getUser(uid)).disabled, 403, "account_disabled");
	} catch (error) {
		if (error instanceof RelayError) throw error;
		if (
			(
				error as {
					code?: string;
				}
			).code === "auth/user-not-found"
		)
			throw new RelayError(410, "account_deleted");
		throw new RelayError(503, "relay_unavailable");
	}
}
/** Verify this project's admitted, revocation-checked phone identity and monitor App Check without enforcing it. */
export async function authenticatePhone(deps: Dependencies, request: CoreRequest): Promise<IdentityClaims> {
	const credential = /^Bearer ([^ ]+)$/.exec(request.authorization ?? "");
	requireCondition(credential, 401, "unauthorized");
	let claims: IdentityClaims;
	try {
		claims = await deps.auth.verifyIdToken(credential[1], true);
	} catch (error) {
		if ((error as { code?: string }).code === "auth/user-not-found") throw new RelayError(410, "account_deleted");
		if ((error as { code?: string }).code === "auth/user-disabled") throw new RelayError(403, "account_disabled");
		throw new RelayError(401, "unauthorized");
	}
	requireCondition(
		claims.aud === deps.projectId &&
			claims.iss === `https://securetoken.google.com/${deps.projectId}` &&
			claims.email_verified === true &&
			["google.com", "password"].includes(claims.firebase?.sign_in_provider ?? ""),
		403,
		"admission_denied",
	);
	await requireLiveAuthUser(deps, claims.uid);
	let valid = false;
	try {
		valid = await deps.verifyAppCheck(request.appCheck);
	} catch {
		// App Check verification failures are observed, never an admission boundary in monitored mode.
	}
	deps.monitor(valid ? "valid" : "invalid");
	return claims;
}
/** Require installation ownership without exposing another account's existence. */
export function requireOwnedInstallation(
	installation: InstallationDocument | undefined,
	uid: string,
): asserts installation is InstallationDocument {
	requireCondition(installation && installation.uid === uid, 404, "not_found");
}
/** Require a route bound to both the owning account and the selected installation. */
export function requireOwnedRoute(
	route: RouteDocument | undefined,
	uid: string,
	installationId: string,
): asserts route is RouteDocument {
	requireCondition(route && route.uid === uid && route.installationId === installationId, 404, "not_found");
}
/** Release expired slot reservations synchronously; TTL deletion is never an authorization check. */
export function pruneReservations(account: ActiveAccountDocument, now: number): ActiveAccountDocument {
	account.phones = Object.fromEntries(
		Object.entries(account.phones).filter(([, reservation]) => !reservation.deadline || reservation.deadline > now),
	);
	account.routes = Object.fromEntries(
		Object.entries(account.routes).filter(([, reservation]) => reservation.deadline > now),
	);
	return account;
}
