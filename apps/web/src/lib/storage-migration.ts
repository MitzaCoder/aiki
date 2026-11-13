declare const __KEMIRI_LEGACY_STORAGE_PREFIX__: string;
/** Empty in public builds. A private hosted build may opt in to copying a prior installation's browser state. */
export const LEGACY_STORAGE_PREFIX = typeof __KEMIRI_LEGACY_STORAGE_PREFIX__ === 'undefined' ? '' : __KEMIRI_LEGACY_STORAGE_PREFIX__;

/** Copy only missing/empty destinations. Keep the originals, including when storage is full or access is denied. */
export function migrateLocalStorage(storage: Storage, legacy = LEGACY_STORAGE_PREFIX): void {
	if (!legacy || legacy === 'aiki') return;
	const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
	for (const key of keys) {
		if (!key?.startsWith(`${legacy}.`)) continue;
		const destination = `aiki.${key.slice(legacy.length + 1)}`;
		if (!storage.getItem(destination)) storage.setItem(destination, storage.getItem(key) ?? '');
	}
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
function transactionDone(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = transaction.onerror = () => reject(transaction.error); });
}

/** There are no app-owned IDB stores today. Preserve any prior namespaced databases without deleting either copy. */
export async function migrateIndexedDB(factory: IDBFactory, legacy = LEGACY_STORAGE_PREFIX): Promise<void> {
	if (!legacy || legacy === 'aiki' || !factory.databases) return;
	const databases = await factory.databases();
	for (const { name } of databases) {
		if (!name?.startsWith(`${legacy}.`)) continue;
		const destination = `aiki.${name.slice(legacy.length + 1)}`;
		// Existing records are authoritative. An empty destination left by an interrupted/early load can retry.
		if (databases.some((database) => database.name === destination)) {
			const existing = await requestValue(factory.open(destination));
			const names = Array.from(existing.objectStoreNames);
			let populated = false;
			try {
				if (names.length) {
					const transaction = existing.transaction(names, 'readonly');
					const done = transactionDone(transaction);
					populated = (await Promise.all(names.map((store) => requestValue(transaction.objectStore(store).count())))).some((count) => count > 0);
					await done;
				}
			} finally { existing.close(); }
			if (populated) continue;
			await requestValue(factory.deleteDatabase(destination));
		}
		const source = await requestValue(factory.open(name));
		let target: IDBDatabase | undefined;
		try {
			const names = Array.from(source.objectStoreNames);
			if (!names.length) continue;
			const read = source.transaction(names, 'readonly');
			const finished = transactionDone(read);
			const stores = await Promise.all(names.map(async (storeName) => {
				const store = read.objectStore(storeName);
				const indexes = Array.from(store.indexNames, (indexName) => { const index = store.index(indexName); return { name: indexName, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry }; });
				const [keys, values] = await Promise.all([requestValue(store.getAllKeys()), requestValue(store.getAll())]);
				return { name: storeName, keyPath: store.keyPath, autoIncrement: store.autoIncrement, indexes, keys, values };
			}));
			await finished;
			const opening = factory.open(destination, source.version);
			opening.onupgradeneeded = () => {
				for (const store of stores) {
					const created = opening.result.createObjectStore(store.name, { keyPath: store.keyPath, autoIncrement: store.autoIncrement });
					for (const index of store.indexes) created.createIndex(index.name, index.keyPath, index);
				}
			};
			target = await requestValue(opening);
			const write = target.transaction(names, 'readwrite');
			const done = transactionDone(write);
			for (const store of stores) {
				const output = write.objectStore(store.name);
				store.values.forEach((value, index) => { if (store.keyPath === null) output.put(value, store.keys[index]); else output.put(value); });
			}
			await done;
		} catch (error) {
			// A failed copy must not leave an empty destination preventing a retry next load.
			target?.close();
			await requestValue(factory.deleteDatabase(destination));
			throw error;
		} finally { source.close(); target?.close(); }
	}
}

/** Copy the service worker's registration record, not stale app shells or hashed assets. */
export async function migrateNotificationCache(storage: CacheStorage, origin: string, legacy = LEGACY_STORAGE_PREFIX): Promise<void> {
	if (!legacy || legacy === 'aiki' || !(await storage.keys()).includes(`${legacy}-notifications`)) return;
	const target = await storage.open('aiki-notifications');
	const destination = new URL('/__aiki/notification-registrations', origin).href;
	if (await target.match(destination)) return;
	const source = await storage.open(`${legacy}-notifications`);
	const response = await source.match(new URL(`/__${legacy}/notification-registrations`, origin).href);
	if (response) await target.put(destination, response);
}
