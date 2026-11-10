import { AuthHttpError } from './device-auth.ts';

type RenewalTransport = {
	readonly connected: boolean;
	request(message: { type: 'auth.renew'; accessToken: string }): Promise<{ type: string }>;
	disconnect(reason: string): void;
	close(): void;
};
type RenewalOutcome = { state: 'renewed' | 'reconnecting' } | { state: 'expired'; notice: string };

/** Failures join socket recovery, which owns backoff and prepares one fresh token per attempt. */
export async function renewBackendAccess(
	auth: { refresh(): Promise<{ accessToken: string }> },
	client: RenewalTransport,
): Promise<RenewalOutcome> {
	let access: { accessToken: string };
	try {
		access = await auth.refresh();
	} catch (error) {
		// Only the retained exchange, not a socket or access-bearer error, can establish session expiry.
		if (error instanceof AuthHttpError && !error.retryable) {
			client.close();
			return { state: 'expired', notice: error.message };
		}
		client.disconnect('Access renewal unavailable');
		return { state: 'reconnecting' };
	}
	// request() connects on demand. A late refresh must not undo sign-out, stop or socket recovery.
	if (!client.connected) return { state: 'reconnecting' };
	try {
		const response = await client.request({ type: 'auth.renew', accessToken: access.accessToken });
		if (response.type === 'error') throw new Error('Access renewal rejected');
		return { state: 'renewed' };
	} catch {
		client.disconnect('Access renewal rejected');
		return { state: 'reconnecting' };
	}
}
