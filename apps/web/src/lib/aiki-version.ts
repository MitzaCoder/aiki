import type { ServerStatus } from "@aiki/protocol";
import { visibleReleaseUpdate } from "./release-updates.ts";

/** Normalize release tags, but leave commit IDs and dev labels alone. */
export function versionLabel(version: string): string {
	return /^v?\d+\.\d+\.\d+/.test(version) ? `v${version.replace(/^v/, "")}` : version;
}

/** Status describes the running code more precisely than hello's protocol package version. */
export function backendVersion(helloVersion?: string, status?: ServerStatus): string | undefined {
	if (status?.updates?.schemaVersion === 1 && status.updates.installedVersion) return versionLabel(status.updates.installedVersion);
	if (status?.release) return /^v?\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(status.release.name)
		? versionLabel(status.release.name) : status.release.commit.slice(0, 7);
	if (status) return "dev";
	return helloVersion ? versionLabel(helloVersion) : undefined;
}

export function aikiVersionLabel(helloVersion: string | undefined, status: ServerStatus | undefined, webVersion: string): string {
	const backend = backendVersion(helloVersion, status);
	const update = visibleReleaseUpdate(status?.updates) ? status?.updates?.available : null;
	const identity = backend ? `Kemiri ${backend}` : "Kemiri";
	const available = update ? ` → ${versionLabel(update.version)} available` : "";
	const web = versionLabel(webVersion);
	return `${identity}${available}${backend === web ? "" : ` · web ${web}`}`;
}

/** An open project's backend wins, even while reconnecting. */
export function versionBackend<T extends { id: string; ready: boolean }>(backends: readonly T[], projectBackendId?: string): T | undefined {
	return backends.find(backend => backend.id === projectBackendId) ?? backends.find(backend => backend.ready) ?? backends[0];
}
