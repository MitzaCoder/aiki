/** Shared release ordering for the installed CLI and the backend's read-only notice. */
export type UpdateChannel = "pilot" | "stable";
export const RELEASES_API = "https://api.github.com/repos/MitzaCoder/kemiri/releases?per_page=100";
export type PublishedRelease = { version: string; notesUrl: string };

function parseVersion(version: string): { core: bigint[]; prerelease: string[] } | undefined {
	const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(version);
	if (!match) return undefined;
	const prerelease = match[4]?.split(".") ?? [];
	if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"))) return undefined;
	return { core: [BigInt(match[1]!), BigInt(match[2]!), BigInt(match[3]!)], prerelease };
}

/** SemVer precedence, ignoring a leading v and build metadata; undefined for malformed versions. */
export function compareReleaseVersions(left: string, right: string): number | undefined {
	const a = parseVersion(left), b = parseVersion(right);
	if (!a || !b) return undefined;
	for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i]! < b.core[i]! ? -1 : 1;
	if (!a.prerelease.length || !b.prerelease.length) return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length ? -1 : 1;
	for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
		const x = a.prerelease[i], y = b.prerelease[i];
		if (x === y) continue;
		if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
		const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
		if (xn && yn) return BigInt(x) < BigInt(y) ? -1 : 1;
		if (xn !== yn) return xn ? -1 : 1;
		return x < y ? -1 : 1;
	}
	return 0;
}

export function releaseChannel(version: string): UpdateChannel {
	return parseVersion(version)?.prerelease.length ? "pilot" : "stable";
}

/** Ignore drafts, invalid tags and non-GitHub links. Pilot follows stable releases too. No pagination/retry storm. */
export function selectChannelRelease(raw: unknown, channel: UpdateChannel): PublishedRelease | null {
	if (!Array.isArray(raw)) return null;
	let newest: PublishedRelease | null = null;
	for (const release of raw) {
		if (!release || typeof release !== "object" || release.draft !== false || typeof release.tag_name !== "string") continue;
		const version = release.tag_name;
		if (!parseVersion(version) || (channel === "stable" && (release.prerelease !== false || releaseChannel(version) === "pilot"))) continue;
		// Derive the URL rather than trusting feed-controlled markup, schemes or hosts.
		const notesUrl = `https://github.com/MitzaCoder/kemiri/releases/tag/${encodeURIComponent(version)}`;
		if (!newest || compareReleaseVersions(version, newest.version)! > 0) newest = { version, notesUrl };
	}
	return newest;
}

export async function fetchChannelRelease(channel: UpdateChannel, transport: typeof fetch = fetch): Promise<PublishedRelease> {
	const response = await transport(RELEASES_API, {
		headers: { Accept: "application/vnd.github+json", "User-Agent": "Aiki-release-check", "X-GitHub-Api-Version": "2022-11-28" },
		signal: AbortSignal.timeout(15_000),
	});
	if (!response.ok) throw new Error(`Release lookup failed (${response.status}); retry later or use --version TAG.`);
	const release = selectChannelRelease(await response.json(), channel);
	if (!release) throw new Error(`No published ${channel} release found; use --version TAG.`);
	return release;
}
