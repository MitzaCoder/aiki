import { migrateIndexedDB, migrateLocalStorage } from './lib/storage-migration.ts';

/** Complete namespace migration before route stores read state or generate a new notification device identity. */
export async function init(): Promise<void> {
	try { migrateLocalStorage(localStorage); }
	catch { console.warn('Browser storage migration deferred: local storage is unavailable or full.'); }
	try {
		// A second tab must not mistake an in-progress destination for an abandoned empty database.
		if (navigator.locks) await navigator.locks.request('aiki-storage-migration', () => migrateIndexedDB(indexedDB));
		else await migrateIndexedDB(indexedDB);
	}
	catch { console.warn('Browser database migration deferred; original data is unchanged.'); }
}
