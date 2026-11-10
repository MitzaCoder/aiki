/** Retained credentials are deliberately separate from address lists and access tokens. */
export type ClaimProof = { claimId: string; claimSecret: string };
export type RetainedSession = {
	sessionId: string;
	sessionToken: string;
	sessionExpiresAt: string;
	rotateAfter: string;
	stagedSuccessor?: string;
};
export type DeviceCredentialRecord = {
	backendId: string;
	origin: string;
	advertised: boolean;
	session?: RetainedSession;
	migration?: ClaimProof;
	migrationDenied?: boolean;
	pairing?: ClaimProof & { grantId?: string; label?: string; started?: boolean };
};
const DATABASE = 'aiki-device-auth';
const RECORDS = 'credentials';
export const STORAGE_WARNING =
	'Device storage is unavailable. This session is memory-only; reopening will need pairing.';
export const credentialKey = (backendId: string, origin: string): string =>
	JSON.stringify([backendId, origin]);

/** A failed transaction switches to memory, without ever copying secrets into localStorage. */
export class DeviceCredentialStore {
	readonly #memory = new Map<string, DeviceCredentialRecord>();
	#database?: Promise<IDBDatabase>;
	memoryOnly = false;
	constructor(readonly factory: IDBFactory | undefined = globalThis.indexedDB) {}
	#open(): Promise<IDBDatabase> {
		return (this.#database ??= new Promise((resolve, reject) => {
			if (!this.factory) return reject(new Error('Storage unavailable'));
			const request = this.factory.open(DATABASE, 1);
			request.onupgradeneeded = () => request.result.createObjectStore(RECORDS);
			request.onsuccess = () => {
				request.result.onversionchange = () => request.result.close();
				resolve(request.result);
			};
			request.onerror = () => reject(request.error);
			request.onblocked = () => reject(new Error('Storage blocked'));
		}));
	}
	async #transaction<T>(
		mode: IDBTransactionMode,
		operation: (store: IDBObjectStore) => IDBRequest<T>,
	): Promise<T> {
		const database = await this.#open();
		return new Promise((resolve, reject) => {
			const transaction = database.transaction(RECORDS, mode);
			const request = operation(transaction.objectStore(RECORDS));
			transaction.oncomplete = () => resolve(request.result);
			transaction.onabort = transaction.onerror = () =>
				reject(transaction.error ?? new Error('Storage failed'));
		});
	}
	async read(backendId: string, origin: string): Promise<DeviceCredentialRecord | undefined> {
		const key = credentialKey(backendId, origin);
		if (!this.memoryOnly) {
			try {
				const record = (await this.#transaction('readonly', (store) => store.get(key))) as
					DeviceCredentialRecord | undefined;
				if (record) this.#memory.set(key, record);
				return record ?? this.#memory.get(key);
			} catch {
				this.memoryOnly = true;
			}
		}
		return structuredClone(this.#memory.get(key));
	}
	async write(record: DeviceCredentialRecord): Promise<void> {
		const key = credentialKey(record.backendId, record.origin);
		this.#memory.set(key, structuredClone(record));
		if (this.memoryOnly) return;
		try {
			await this.#transaction('readwrite', (store) => store.put(record, key));
		} catch {
			this.memoryOnly = true;
		}
	}
	async pendingPairing(): Promise<DeviceCredentialRecord | undefined> {
		await this.atOrigin('');
		return structuredClone(
			[...this.#memory.values()].find((record) => record.pairing?.started && !record.session),
		);
	}
	async atOrigin(origin: string): Promise<DeviceCredentialRecord | undefined> {
		if (!this.memoryOnly) {
			try {
				const records = (await this.#transaction('readonly', (store) =>
					store.getAll(),
				)) as DeviceCredentialRecord[];
				for (const record of records)
					this.#memory.set(credentialKey(record.backendId, record.origin), record);
			} catch {
				this.memoryOnly = true;
			}
		}
		return structuredClone([...this.#memory.values()].find((record) => record.origin === origin));
	}
}
export const deviceCredentials = new DeviceCredentialStore();
export function randomSecret(prefix: string): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return `${prefix}.${btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '')}`;
}
export const newClaimProof = (): ClaimProof => ({
	claimId: crypto.randomUUID(),
	claimSecret: randomSecret('aiki_c1'),
});

/** Web Locks serialize read-stage-rotate-commit across tabs; no unsafe unlocked rotation fallback. */
export async function withCredentialLock<T>(
	key: string,
	work: () => Promise<T>,
	locks = globalThis.navigator?.locks,
): Promise<T> {
	if (!locks)
		throw new Error('This browser cannot safely rotate a device session. Use a browser with Web Locks.');
	return locks.request(`aiki-device-auth:${key}`, work);
}
