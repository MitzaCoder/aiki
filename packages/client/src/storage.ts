/**
 * Helpers on top of the protocol's storage and disk types: what `projects.storage` reads as, which items a cleanup
 * removes, and how full a backend's disks are.
 *
 * The server decides when a disk is low (`DiskStatus.low`, its threshold); the app only shows it.
 */
import type { DiskStatus, ProjectsStorageCleanResponse, ProjectsStorageResponse, ServerStatus, StorageItem } from "@kemiri/protocol";

/** A project's workspaces on disk, as `readProjectStorage` returns them. */
export type ProjectStorage = Pick<ProjectsStorageResponse, "totalBytes" | "items" | "measuredAt">;

/** What a cleanup removed, freed and refused. */
export type StorageCleanResult = Pick<ProjectsStorageCleanResponse, "removed" | "freedBytes" | "refused">;

/** The items `cleanProjectStorage` without IDs would remove, and the bytes they hold. */
export function removableStorage(items: readonly StorageItem[]): { items: StorageItem[]; bytes: number } {
	const removable = items.filter((item) => item.removable);
	return { items: removable, bytes: removable.reduce((sum, item) => sum + item.bytes, 0) };
}

/** The storage after a cleanup: removed items dropped, the total lowered by what they held. */
export function withoutRemoved(storage: ProjectStorage, removed: readonly string[]): ProjectStorage {
	const gone = new Set(removed);
	const items = storage.items.filter((item) => !gone.has(item.id));
	const freed = storage.items.filter((item) => gone.has(item.id)).reduce((sum, item) => sum + item.bytes, 0);
	return { ...storage, items, totalBytes: Math.max(0, storage.totalBytes - freed) };
}

/** A backend's disks, empty for an older server that does not report them. */
export function serverDisks(status: ServerStatus | null | undefined): DiskStatus[] {
	return status?.disks ?? [];
}

/** The disks below the server's threshold. */
export function lowDisks(status: ServerStatus | null | undefined): DiskStatus[] {
	return serverDisks(status).filter((disk) => disk.low);
}

/**
 * How a disk reads: `low` when the server says so, `tight` when it is not low yet but has less than twice the free space
 * of its default threshold (30%), `ok` otherwise.
 */
export type DiskLevel = "ok" | "tight" | "low";

export const DISK_TIGHT_FREE_SHARE = 0.3;

export function diskLevel(disk: DiskStatus): DiskLevel {
	if (disk.low) return "low";
	if (disk.totalBytes > 0 && disk.freeBytes / disk.totalBytes < DISK_TIGHT_FREE_SHARE) return "tight";
	return "ok";
}
