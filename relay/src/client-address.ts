import { isIP } from "node:net";
/**
 * Take only the address appended by the Cloud Run Google front end, never a caller-controlled earlier XFF entry.
 * This assumes the direct 2nd-gen endpoint, not a custom proxy chain. Verify the suffix on the real ingress before
 * using it for limits. Missing/malformed platform metadata returns an empty address for fail-closed metering.
 * The loopback emulator has no Google front end and ignores XFF entirely.
 */
export function trustedClientAddress(
	forwardedFor: string | undefined,
	socketAddress: string | undefined,
	emulator: boolean,
): string {
	const address = emulator ? socketAddress?.trim() : forwardedFor?.split(",").at(-1)?.trim();
	if (!address || !isIP(address)) return "";
	if (emulator && !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address)) return "";
	return address;
}
