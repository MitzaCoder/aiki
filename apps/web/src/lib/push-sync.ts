/** Worker-to-page repair markers only. No session, token, endpoint or notification content is stored here. */
export const PUSH_CHANGED_MESSAGE = "notifications-changed";
const DATABASE = "aiki.push-sync.v1";
const STORE = "scopes";

async function database(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DATABASE, 1);
		request.onupgradeneeded = () => request.result.createObjectStore(STORE);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

/** Read repair generations so a page cannot clear a newer worker change that arrives during registration. */
export async function pushSyncMarkers(): Promise<Record<string, string>> {
	const db = await database();
	try {
		return await new Promise((resolve, reject) => {
			const transaction = db.transaction(STORE, "readonly");
			const store = transaction.objectStore(STORE);
			const keys = store.getAllKeys();
			const values = store.getAll();
			transaction.oncomplete = () =>
				resolve(Object.fromEntries(keys.result.map((key, index) => [String(key), String(values.result[index])])));
			transaction.onerror = transaction.onabort = () => reject(transaction.error);
		});
	} finally {
		db.close();
	}
}

/** Read scopes awaiting authenticated page repair; never reads credentials. */
export async function pushSyncScopes(): Promise<string[]> {
	return Object.keys(await pushSyncMarkers());
}

/** Clear only the generation the page repaired, preserving concurrent worker changes. */
export async function clearPushSyncMarker(scope: string, expected: string): Promise<void> {
	const db = await database();
	try {
		await new Promise<void>((resolve, reject) => {
			const transaction = db.transaction(STORE, "readwrite");
			const store = transaction.objectStore(STORE);
			const request = store.get(scope);
			request.onsuccess = () => {
				if (String(request.result) === expected) store.delete(scope);
			};
			transaction.oncomplete = () => resolve();
			transaction.onerror = transaction.onabort = () => reject(transaction.error);
		});
	} finally {
		db.close();
	}
}

/** Atomically set or explicitly discard a scope's marker without storing a subscription or bearer. */
export async function setPushSyncNeeded(scope: string, needed: boolean): Promise<void> {
	const db = await database();
	try {
		await new Promise<void>((resolve, reject) => {
			const transaction = db.transaction(STORE, "readwrite");
			const store = transaction.objectStore(STORE);
			if (needed) store.put(crypto.randomUUID(), scope);
			else store.delete(scope);
			transaction.oncomplete = () => resolve();
			transaction.onerror = transaction.onabort = () => reject(transaction.error);
		});
	} finally {
		db.close();
	}
}
