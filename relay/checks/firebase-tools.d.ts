declare module "firebase-tools/lib/emulator/auth/server.js" {
	/** Construct the official in-process Auth emulator for a synthetic project. */
	export function createApp(projectId: string): Promise<import("node:http").RequestListener>;
}
