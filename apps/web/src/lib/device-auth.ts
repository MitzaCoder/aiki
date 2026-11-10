import { decodePairingFragment, type PairingFragment } from '@aiki/protocol';
import { normalizeBackendUrl } from './backends.ts';
import {
	credentialKey,
	deviceCredentials,
	newClaimProof,
	randomSecret,
	withCredentialLock,
	type ClaimProof,
	type DeviceCredentialRecord,
	type DeviceCredentialStore,
} from './device-credentials.ts';
export type AuthStatus = { backendId: string; mode: 'off' | 'optional' | 'required'; authVersion: 1 };
export type AccessCredentials = {
	backendId: string;
	sessionId: string;
	accessToken: string;
	accessExpiresAt: string;
	sessionExpiresAt: string;
	rotateAfter: string;
};
export type SessionCredentials = AccessCredentials & { sessionToken: string };
export type ClaimResult = {
	claimId: string;
	state: 'pending' | 'approved' | 'denied' | 'acknowledged' | 'expired';
	comparisonCode: string;
	credentials: SessionCredentials | null;
};
export class AuthHttpError extends Error {
	constructor(
		readonly code: string,
		readonly status: number,
		readonly retryAfter: number,
	) {
		super(authErrorText(code));
	}
}
export function authErrorText(code: string): string {
	if (code === 'auth_revoked') return 'This device was signed out';
	if (code === 'auth_expired' || code === 'auth_invalid') return 'Session expired';
	if (code === 'auth_required') return 'Pair this backend';
	if (code === 'grant_used') return 'This link was already used. Ask for a new pairing link.';
	if (code.includes('expired')) return 'This pairing has expired. Ask for a new link.';
	if (code.includes('denied')) return 'Pairing was denied. Ask for a new link.';
	return 'Sign-in could not complete. Check the backend and try again.';
}
/** Never follow a credential-bearing redirect, cache a reply, or include cookies. */
export async function authRequest<T>(
	origin: string,
	path: string,
	body?: unknown,
	token?: string,
): Promise<T> {
	const response = await fetch(new URL(path, origin), {
		method: body === undefined ? 'GET' : 'POST',
		redirect: 'error',
		cache: 'no-store',
		credentials: 'omit',
		referrerPolicy: 'no-referrer',
		headers: {
			...(body === undefined ? {} : { 'content-type': 'application/json' }),
			...(token ? { authorization: `Bearer ${token}` } : {}),
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
		signal: AbortSignal.timeout(15_000),
	});
	if (!response.ok) {
		const error = await response.json().catch(() => ({}));
		throw new AuthHttpError(
			error?.error?.code ?? 'auth_invalid',
			response.status,
			Math.max(1, Number(response.headers.get('retry-after')) || 1),
		);
	}
	return response.json() as Promise<T>;
}
export const renewIn = (expiresAt: string, now = Date.now()): number =>
	Math.max(1000, Date.parse(expiresAt) - now - 60_000);
export const rotationDue = (rotateAfter: string, now = Date.now()): boolean => Date.parse(rotateAfter) <= now;
export function browserDeviceLabel(agent = globalThis.navigator?.userAgent ?? ''): string {
	const browser = /Firefox/.test(agent)
		? 'Firefox'
		: /Edg\//.test(agent)
			? 'Edge'
			: /Chrome/.test(agent)
				? 'Chrome'
				: /Safari/.test(agent)
					? 'Safari'
					: 'Browser';
	const platform = /Android/.test(agent)
		? 'Android'
		: /iPhone|iPad/.test(agent)
			? 'iOS'
			: /Windows/.test(agent)
				? 'Windows'
				: /Macintosh/.test(agent)
					? 'macOS'
					: /Linux/.test(agent)
						? 'Linux'
						: 'this device';
	return `${browser} on ${platform}`;
}
export type PairPageLink =
	| (PairingFragment & { kind: 'pair' })
	| { kind: 'bootstrap'; backendId?: string; backendOrigin: string; requestId: string; code?: string };
/** Clear the secret before decoding it or starting any discovery request. */
export function consumePairFragment(
	location: Pick<Location, 'hash' | 'origin' | 'pathname' | 'search'>,
	history: Pick<History, 'replaceState' | 'state'>,
): PairPageLink | undefined {
	const fragment = location.hash;
	history.replaceState(history.state, '', location.pathname + location.search);
	if (!fragment) return undefined;
	if (fragment.startsWith('#pair=')) return { kind: 'pair', ...decodePairingFragment(fragment) };
	if (/^#bootstrap=aiki_b1\.[A-Za-z0-9_-]{43}$/.test(fragment))
		return {
			kind: 'bootstrap',
			backendOrigin: normalizeBackendUrl(location.origin),
			requestId: 'local',
			code: fragment.slice(11),
		};
	const match = /^#bootstrap=v1\.([A-Za-z0-9_-]{1,4096})$/.exec(fragment);
	if (!match) throw new Error('Invalid pairing link. Ask for a new link.');
	const array: unknown = JSON.parse(
		new TextDecoder('utf-8', { fatal: true }).decode(
			Uint8Array.from(atob(match[1]!.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
		),
	);
	if (
		!Array.isArray(array) ||
		array.length !== 3 ||
		!array.every((value) => typeof value === 'string' && value.length > 0)
	)
		throw new Error('Invalid bootstrap link.');
	return {
		kind: 'bootstrap',
		backendId: array[0],
		backendOrigin: normalizeBackendUrl(array[1]),
		requestId: array[2],
	};
}
export class BackendDeviceAuth {
	backendId?: string;
	mode?: AuthStatus['mode'];
	#access?: AccessCredentials;
	get accessExpiresAt(): string | undefined {
		return this.#access?.accessExpiresAt;
	}
	constructor(
		readonly origin: string,
		readonly store: DeviceCredentialStore = deviceCredentials,
	) {}
	async discover(): Promise<AuthStatus | undefined> {
		const pinned = await this.store.atOrigin(this.origin);
		let status: AuthStatus;
		try {
			status = await authRequest<AuthStatus>(this.origin, '/auth/status');
		} catch (error) {
			// Only an explicit 404 is legacy discovery. Network/forbidden errors must not downgrade.
			if (!pinned?.advertised && error instanceof AuthHttpError && error.status === 404) return undefined;
			throw error;
		}
		if (
			status.authVersion !== 1 ||
			!status.backendId ||
			!['off', 'optional', 'required'].includes(status.mode)
		)
			throw new Error('Unsupported backend sign-in version.');
		if (pinned?.advertised && pinned.backendId !== status.backendId)
			throw new Error('Backend identity changed. Pair this backend again at its confirmed address.');
		this.backendId = status.backendId;
		this.mode = status.mode;
		if (!pinned?.advertised)
			await this.store.write({
				...pinned,
				backendId: status.backendId,
				origin: this.origin,
				advertised: true,
			});
		return status;
	}
	async pinHello(backendId: string): Promise<void> {
		const record = await this.store.atOrigin(this.origin);
		if (record?.advertised && record.backendId !== backendId)
			throw new Error('Backend identity changed. Pair this backend again.');
		this.backendId = backendId;
		if (!record?.advertised)
			await this.store.write({ ...record, backendId, origin: this.origin, advertised: true });
	}
	async record(): Promise<DeviceCredentialRecord> {
		if (!this.backendId) throw new Error('Discover backend first.');
		return (
			(await this.store.read(this.backendId, this.origin)) ?? {
				backendId: this.backendId,
				origin: this.origin,
				advertised: true,
			}
		);
	}
	async prepare(): Promise<string | undefined> {
		await this.discover();
		if (!this.backendId) return undefined;
		const record = await this.record();
		if (!record.session) {
			if (this.mode === 'required') throw new AuthHttpError('auth_required', 401, 0);
			return undefined;
		}
		const access = await this.refresh();
		// A crash after durable storage but before acknowledgement must not lose the delivery proof.
		for (const proof of [record.migration, record.pairing])
			if (proof) {
				try {
					await this.acknowledge(proof);
				} catch {
					/* Retry on next connection. */
				}
			}
		return access.accessToken;
	}
	async refresh(): Promise<AccessCredentials> {
		if (!this.backendId) throw new Error('Discover backend first.');
		const work = async () => {
			const record = await this.record();
			let session = record.session;
			if (!session) throw new AuthHttpError('auth_required', 401, 0);
			if (session.stagedSuccessor || rotationDue(session.rotateAfter)) {
				if (!session.stagedSuccessor) {
					session.stagedSuccessor = randomSecret(`aiki_s1.${session.sessionId}`);
					await this.store.write(record);
					if (this.store.memoryOnly)
						throw new Error('Cannot rotate without durable device storage. Pair again.');
				}
				const rotated = await authRequest<{ rotateAfter: string }>(
					this.origin,
					'/auth/session/rotate',
					{ successorToken: session.stagedSuccessor },
					session.sessionToken,
				);
				session = { ...session, sessionToken: session.stagedSuccessor, rotateAfter: rotated.rotateAfter };
				delete session.stagedSuccessor;
				record.session = session;
				await this.store.write(record);
			}
			const access = await authRequest<AccessCredentials>(
				this.origin,
				'/auth/session/refresh',
				{},
				session.sessionToken,
			);
			if (access.backendId !== this.backendId || access.sessionId !== session.sessionId)
				throw new Error('Backend identity mismatch.');
			record.session = {
				...session,
				sessionExpiresAt: access.sessionExpiresAt,
				rotateAfter: access.rotateAfter,
			};
			await this.store.write(record);
			this.#access = access;
			return access;
		};
		// Browsers without Web Locks can refresh, but must never attempt an unlocked rotation.
		if (!globalThis.navigator?.locks) {
			const record = await this.record();
			if (record.session && (record.session.stagedSuccessor || rotationDue(record.session.rotateAfter)))
				throw new Error('Session rotation needs a browser with Web Locks.');
			return work();
		}
		return withCredentialLock(credentialKey(this.backendId, this.origin), work);
	}
	async save(credentials: SessionCredentials): Promise<void> {
		if (this.backendId !== credentials.backendId) throw new Error('Backend identity mismatch.');
		const record = await this.record();
		record.session = {
			sessionId: credentials.sessionId,
			sessionToken: credentials.sessionToken,
			sessionExpiresAt: credentials.sessionExpiresAt,
			rotateAfter: credentials.rotateAfter,
		};
		await this.store.write(record);
		this.#access = credentials;
	}
	async proof(kind: 'migration' | 'pairing'): Promise<ClaimProof> {
		const create = async () => {
			const record = await this.record();
			const proof = record[kind] ?? newClaimProof();
			record[kind] = proof;
			await this.store.write(record);
			return proof;
		};
		return globalThis.navigator?.locks
			? withCredentialLock(credentialKey(this.backendId!, this.origin), create)
			: create();
	}
	async acknowledge(proof: ClaimProof): Promise<void> {
		await authRequest(this.origin, '/auth/claims/ack', proof);
		const record = await this.record();
		if (record.pairing?.claimId === proof.claimId) delete record.pairing;
		if (record.migration?.claimId === proof.claimId) delete record.migration;
		await this.store.write(record);
	}
	async acceptClaim(result: ClaimResult, proof: ClaimProof): Promise<boolean> {
		if (result.state !== 'approved' || !result.credentials) return false;
		await this.save(result.credentials);
		// A failed ack does not undo a stored session; it is retried on the next connection.
		try {
			await this.acknowledge(proof);
		} catch {
			/* Delivery expires server-side after 60 seconds. */
		}
		return true;
	}
}
