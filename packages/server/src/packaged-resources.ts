/** Replaced by the binary builder with file imports. Source installs keep the published package layout. */
import type { ReleaseInfo } from "@kemiri/protocol";

export type PackagedResources = {
	web?: Readonly<Record<string, string>>;
	/** Relative skill-folder/file paths mapped to bundled asset paths. */
	skills?: Readonly<Record<string, string>>;
	quickjsWasm?: string;
	codemodeWorker?: string;
	photonWasm?: string;
	photonWorker?: string;
	release?: ReleaseInfo;
 installer?: string;
};
export const packagedResources: PackagedResources = {};
