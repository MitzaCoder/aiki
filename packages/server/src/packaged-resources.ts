/** Replaced by the binary builder with file imports. Source installs keep the published package layout. */
import type { ReleaseInfo } from "@aiki/protocol";

export type PackagedResources = {
	web?: Readonly<Record<string, string>>;
	quickjsWasm?: string;
	codemodeWorker?: string;
	photonWasm?: string;
	photonWorker?: string;
	release?: ReleaseInfo;
};
export const packagedResources: PackagedResources = {};
