import type { Firestore } from "firebase-admin/firestore";
export interface IdentityClaims {
	uid: string;
	aud: string;
	iss: string;
	email_verified?: boolean;
	firebase?: {
		sign_in_provider?: string;
	};
}
export interface AuthPort {
	verifyIdToken(token: string, checkRevoked: true): Promise<IdentityClaims>;
	getUser(uid: string): Promise<{
		disabled: boolean;
	}>;
}
export interface FcmMessage {
	token: string;
	data: Record<string, string>;
	priority: "normal" | "high";
	ttlMs: number;
}
export type FcmResult = "accepted" | "unregistered" | "rate_limited" | "unavailable" | "timeout";
export interface Dependencies {
	firestore: Firestore;
	auth: AuthPort;
	projectId: string;
	send(message: FcmMessage): Promise<FcmResult>;
	now(): number;
	random(bytes: number): string;
	verifyAppCheck(token: string | undefined): Promise<boolean>;
	monitor(outcome: "valid" | "invalid"): void;
}
export interface CoreRequest {
	method: string;
	path: string;
	authorization?: string;
	appCheck?: string;
	body: string;
	contentType?: string;
	clientIp: string;
	contentEncoding?: string;
}
export interface InventoryEntry {
	installationId: string;
	state: string;
	createdAt: number;
	lastManagementAt: number | null;
}
export interface RelayResponseBody {
	error?: string;
	state?: string;
	code?: string;
	retryAt?: number;
	generation?: number;
	installationId?: string;
	challengeId?: string;
	deadline?: number;
	routeId?: string;
	leaseExpiresAt?: number;
	absoluteExpiresAt?: number;
	phones?: number;
	routes?: number;
	phoneLimit?: number;
	routeLimit?: number;
	installations?: InventoryEntry[];
}
export interface CoreResponse {
	status: number;
	headers: Record<string, string>;
	body?: RelayResponseBody;
}
export interface EndpointResult {
	status: number;
	body: RelayResponseBody;
	retryAt?: number;
}
export const MINUTE = 60000;
export const DAY = 86400000;
