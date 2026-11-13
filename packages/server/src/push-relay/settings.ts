import type { Environment } from "../data-dir.ts";
import { serverSettings } from "../server-settings.ts";

/** Private, operator-approved v1 base URL. No account or administrative credential is used. */
export const PUSH_RELAY_ENDPOINT_SETTING = "KEMIRI_PUSH_RELAY_ENDPOINT";

/** Resolve only the private settings snapshot; reject insecure endpoints and credential-bearing URLs. */
export function resolvePushRelayEndpoint(env: Environment = serverSettings): string | undefined {
	const setting = env[PUSH_RELAY_ENDPOINT_SETTING]?.trim();
	return setting ? validatePushRelayEndpoint(setting) : undefined;
}

/** Validate the operator's base URL; permit cleartext only on literal loopback/localhost for tests. */
export function validatePushRelayEndpoint(endpoint: string): string {
	const url = new URL(endpoint);
	const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
	if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
		url.username || url.password || url.search || url.hash) {
		throw new Error("Invalid push relay endpoint");
	}
	return `${url.href.replace(/\/+$/, "")}/`;
}
