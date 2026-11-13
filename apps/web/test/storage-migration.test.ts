import { expect, test } from 'bun:test';
import { IDBFactory } from 'fake-indexeddb';
import { migrateIndexedDB, migrateLocalStorage, migrateNotificationCache } from '../src/lib/storage-migration.ts';
import { legacyStoragePrefix } from '../vite-legacy-storage.ts';

function memoryStorage(entries: Record<string, string>): Storage {
	const values = new Map(Object.entries(entries));
	return { get length() { return values.size; }, clear: () => values.clear(), key: (index) => Array.from(values.keys())[index] ?? null,
		getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } };
}
function opened(request: IDBOpenDBRequest): Promise<IDBDatabase> { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
function done(transaction: IDBTransaction): Promise<void> { return new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); }); }

test('public builds have no legacy prefix when no private config is present', () => {
	expect(legacyStoragePrefix({}, '/nonexistent/example')).toBe('');
	expect(legacyStoragePrefix({ KEMIRI_LEGACY_STORAGE_PREFIX: 'previous-app' })).toBe('previous-app');
	expect(() => legacyStoragePrefix({ KEMIRI_LEGACY_STORAGE_PREFIX: '../invalid' })).toThrow();
});

test('copies every legacy local key, keeps newer state and originals; a repeat is safe', () => {
	const storage = memoryStorage({ 'previous-app.backends.v1': '[1]', 'previous-app.theme.v1': 'dark', 'previous-app.drafts.v1': 'draft', 'aiki.theme.v1': 'light', 'aiki.drafts.v1': '', 'unrelated.key': 'private' });
	migrateLocalStorage(storage, 'previous-app'); migrateLocalStorage(storage, 'previous-app');
	expect(storage.getItem('aiki.backends.v1')).toBe('[1]'); expect(storage.getItem('aiki.theme.v1')).toBe('light');
	expect(storage.getItem('aiki.drafts.v1')).toBe('draft'); expect(storage.getItem('previous-app.backends.v1')).toBe('[1]');
	expect(storage.getItem('aiki.key')).toBeNull();
});

test('copies IDB records, keys, version, indexes and schema; keeps the source and existing target', async () => {
	const factory = new IDBFactory(); const opening = factory.open('previous-app.cache', 3);
	opening.onupgradeneeded = () => { const store = opening.result.createObjectStore('records', { keyPath: 'id', autoIncrement: true }); store.createIndex('by-name', 'name', { unique: true }); opening.result.createObjectStore('blobs'); };
	const source = await opened(opening); const write = source.transaction(['records', 'blobs'], 'readwrite');
	write.objectStore('records').put({ id: 7, name: 'draft', text: 'retained' }); write.objectStore('blobs').put(new Blob(['image']), 'attachment'); await done(write); source.close();
	// An earlier interrupted load may have created an empty destination with the wrong version/schema.
	const empty = await opened(factory.open('aiki.cache')); empty.close();
	await migrateIndexedDB(factory, 'previous-app'); await migrateIndexedDB(factory, 'previous-app');
	const target = await opened(factory.open('aiki.cache')); expect(target.version).toBe(3);
	const read = target.transaction(['records', 'blobs']); const record = read.objectStore('records'); expect(record.keyPath).toBe('id'); expect(record.autoIncrement).toBe(true); expect(record.index('by-name').unique).toBe(true);
	const get = record.get(7); const result = await new Promise<any>((resolve) => { get.onsuccess = () => resolve(get.result); }); expect(result.text).toBe('retained'); await done(read); target.close();
	expect((await factory.databases()).map((entry) => entry.name).sort()).toEqual(['aiki.cache', 'previous-app.cache']);
});

test('service-worker registration cache is copied once, not app shells or existing registrations', async () => {
	const values = new Map<string, Map<string, Response>>([['previous-app-notifications', new Map([['https://app.example.test/__previous-app/notification-registrations', new Response('["registration"]')]])]]);
	const storage = { keys: async () => [...values.keys()], open: async (name: string) => {
		if (!values.has(name)) values.set(name, new Map()); const cache = values.get(name)!;
		return { match: async (url: string) => cache.get(url)?.clone(), put: async (url: string, response: Response) => { cache.set(url, response.clone()); } };
	} } as unknown as CacheStorage;
	await migrateNotificationCache(storage, 'https://app.example.test', 'previous-app');
	const cache = await storage.open('aiki-notifications'); const url = 'https://app.example.test/__aiki/notification-registrations';
	expect(await (await cache.match(url))!.text()).toBe('["registration"]');
	await cache.put(url, new Response('["newer"]')); await migrateNotificationCache(storage, 'https://app.example.test', 'previous-app');
	expect(await (await cache.match(url))!.text()).toBe('["newer"]'); expect(values.size).toBe(2);
});
