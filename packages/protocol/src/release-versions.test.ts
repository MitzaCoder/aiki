import { expect, test } from "bun:test";
import { compareReleaseVersions, releaseChannel, selectChannelRelease } from "./release-versions.ts";

test("SemVer ordering includes pilot, numeric identifiers, stable, build metadata and invalid tags", () => {
	const ordered = ["v0.1.0-pilot.1", "v0.1.0-pilot.2", "v0.1.0-pilot.10", "v0.1.0", "v0.1.1", "v1.0.0"];
	for (let i = 1; i < ordered.length; i++) {
		expect(compareReleaseVersions(ordered[i - 1]!, ordered[i]!)).toBe(-1);
		expect(compareReleaseVersions(ordered[i]!, ordered[i - 1]!)).toBe(1);
	}
	for (const [a, b] of [["1.0.0-alpha", "1.0.0-alpha.1"], ["1.0.0-1", "1.0.0-alpha"], ["1.0.0-beta.2", "1.0.0-beta.11"]]) expect(compareReleaseVersions(a!, b!)).toBe(-1);
	expect(compareReleaseVersions("v1.0.0+build.1", "1.0.0+other")).toBe(0);
	for (const invalid of ["latest", "01.2.3", "1.2", "1.2.3-pilot.01", "../../oops"]) expect(compareReleaseVersions(invalid, "1.0.0")).toBeUndefined();
});

test("pilot includes prereleases and stable; stable excludes prerelease flags and tags, drafts and invalid tags", () => {
	const release = (tag_name: string, prerelease = false, draft = false) => ({ tag_name, prerelease, draft });
	const feed = [release("v0.1.0"), release("v0.2.0-pilot.2", true), release("v0.2.0-pilot.1", true), release("v9.0.0", false, true), release("garbage")];
	expect(selectChannelRelease(feed, "stable")?.version).toBe("v0.1.0");
	expect(selectChannelRelease(feed, "pilot")?.version).toBe("v0.2.0-pilot.2");
	expect(selectChannelRelease([...feed, release("v0.2.0")], "pilot")?.version).toBe("v0.2.0");
	expect(selectChannelRelease([release("v0.1.0-pilot.1")], "stable")).toBeNull();
	expect(selectChannelRelease([release("v0.1.0", true)], "stable")).toBeNull();
	expect(selectChannelRelease(null, "pilot")).toBeNull();
	expect(releaseChannel("v0.1.0-pilot.1")).toBe("pilot");
	expect(releaseChannel("v0.1.0")).toBe("stable");
});
