import type { Artifact } from "@kemiri/protocol";

/** Snapshot IDs pin all preview/download leases to bytes rather than a moving latest ID. */
export function artifactVersions(artifact: Artifact): Artifact[] {
	return (artifact.versions?.length ? artifact.versions : [artifact]).map((snapshot) => ({
		...snapshot,
		versionCount: artifact.versionCount ?? artifact.version ?? 1,
	}));
}

export function selectedArtifactVersion(artifact: Artifact, version?: number): Artifact {
	const retained = artifactVersions(artifact);
	return retained.find((snapshot) => snapshot.version === version) ?? retained.at(-1)!;
}
