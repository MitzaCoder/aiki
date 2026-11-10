/** Durable backend-local owner authentication; no network identity is inferred from a name or address. */
import { Database } from "bun:sqlite";
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deviceComparisonCode, type AuthDevice, type AuthPairing, type DeviceAuthMode } from "@aiki/protocol";

const MINUTE = 60_000,
	DAY = 86400_000;
export const ACCESS_TTL = 15 * MINUTE;
export class DeviceAuthError extends Error {
	constructor(
		readonly code: string,
		readonly status = 401,
		readonly retryAfter = 0,
	) {
		super(code);
	}
}
const fail = (code = "auth_invalid", status = 401): never => {
	throw new DeviceAuthError(code, status, status === 429 ? 60 : 0);
};
const id = () => randomBytes(16).toString("hex");
export const authSecret = (prefix: string) => `${prefix}.${randomBytes(32).toString("base64url")}`;
const hash = (secret: string) => createHash("sha256").update(secret).digest("hex");
function matches(secret: string, stored: string): boolean {
	const a = Buffer.from(hash(secret), "hex"),
		b = Buffer.from(stored, "hex");
	return a.length === b.length && timingSafeEqual(a, b);
}
function mode(value: unknown): DeviceAuthMode {
	if (value !== "off" && value !== "optional" && value !== "required") return fail("bad_request", 400);
	return value;
}
export type Identity = { sessionId: string; accessExpiresAt: number };
type Session = {
	id: string;
	label: string;
	platform: string;
	created: number;
	lastUsed: number;
	rotated: number;
	retainedHash: string;
	revoked: number | null;
	previousHash?: string;
	rotationHash?: string;
	rotationUntil?: number;
};
type Access = { sessionId: string; hash: string; expires: number };
type Grant = {
	id: string;
	owner: string | null;
	hash: string;
	created: number;
	expires: number;
	confirm: boolean;
	state: AuthPairing["state"];
	claimId: string | null;
	local?: boolean;
	attempts?: number;
	bootstrap?: boolean;
};
type Claim = {
	id: string;
	hash: string;
	grantId: string;
	label: string;
	platform: string;
	code: string;
	created: number;
	lastSeen: number;
	source: string;
	state: "pending" | "approved" | "denied" | "acknowledged" | "expired";
	delivery?: string;
	deliveryUntil?: number;
	sessionId?: string;
};
type State = {
	backendId: string;
	mode: DeviceAuthMode;
	sessions: Session[];
	access: Record<string, Access>;
	grants: Grant[];
	claims: Claim[];
	batches: Record<string, string[]>;
	hosts: string[];
	observedHosts: string[];
};
export type SessionCredentials = {
	backendId: string;
	sessionId: string;
	sessionToken: string;
	accessToken: string;
	accessExpiresAt: string;
	sessionExpiresAt: string;
	rotateAfter: string;
};
export type AuthOptions = {
	mode?: DeviceAuthMode;
	backendOrigins?: readonly string[];
	trustedProxies?: readonly string[];
	controlSocket?: boolean;
};
export class DeviceAuth {
	readonly db: Database;
	readonly #key: Buffer;
	readonly now: () => number;
	readonly #state: State;
	readonly #limits = new Map<string, { start: number; count: number }>();
	readonly connected = new Map<string, number>();
	onRevoke: ((sessionId: string) => Promise<void>) | undefined;
	onAudit: ((event: string, identifier: string) => void) | undefined;
	onMode: ((mode: DeviceAuthMode) => void) | undefined;
	onChange: (() => void) | undefined;
	onPairing: ((owner: string, pairing: AuthPairing) => void) | undefined;
	constructor(
		readonly dir: string,
		options: AuthOptions = {},
		now: () => number = Date.now,
	) {
		this.now = now;
		const existing = existsSync(dir) && readdirSync(dir).some((name) => !name.startsWith("auth."));
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		chmodSync(dir, 0o700);
		const file = join(dir, "auth.sqlite");
		// DELETE journal keeps the only persistent file owner-only, including on a clean restart.
		this.db = new Database(file, { create: true });
		chmodSync(file, 0o600);
		this.db.exec(
			"PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS auth (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL)",
		);
		const row = this.db.query("SELECT state FROM auth WHERE id=1").get() as { state: string } | null;
		this.#state = row
			? JSON.parse(row.state)
			: {
					backendId: id(),
					mode: existing ? "optional" : "required",
					sessions: [],
					access: {},
					grants: [],
					claims: [],
					batches: {},
					hosts: [],
					observedHosts: [],
				};
		const override = options.mode ?? process.env.AIKI_AUTH_MODE;
		if (override !== undefined) this.#state.mode = mode(override);
		const origins =
			options.backendOrigins ??
			process.env.AIKI_BACKEND_ORIGINS?.split(",").filter(Boolean) ??
			(process.env.AIKI_PUBLIC_URL ? [new URL(process.env.AIKI_PUBLIC_URL).origin] : undefined);
		if (origins) this.#state.hosts = [...new Set(origins.map(validateBackendOrigin))];
		const keyFile = join(dir, "auth.delivery-key");
		if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32), { mode: 0o600, flag: "wx" });
		chmodSync(keyFile, 0o600);
		this.#key = readFileSync(keyFile);
		this.sweep();
		this.save();
	}
	get backendId() {
		return this.#state.backendId;
	}
	get mode() {
		return this.#state.mode;
	}
	get hosts() {
		return [...this.#state.hosts];
	}
	status() {
		return { backendId: this.backendId, mode: this.mode, authVersion: 1 };
	}
	save() {
		this.db.transaction(() =>
			this.db
				.query("INSERT INTO auth(id,state) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state")
				.run(JSON.stringify(this.#state)),
		)();
	}
	sweep() {
		let changed = false;
		for (const [key, a] of Object.entries(this.#state.access))
			if (a.expires + MINUTE <= this.now()) {
				delete this.#state.access[key];
				changed = true;
			}
		for (const session of this.#state.sessions)
			if (session.rotationUntil && session.rotationUntil <= this.now()) {
				delete session.previousHash;
				delete session.rotationHash;
				delete session.rotationUntil;
				changed = true;
			}
		for (const c of this.#state.claims) {
			if (c.deliveryUntil && c.deliveryUntil <= this.now() && c.delivery) {
				delete c.delivery;
				changed = true;
			}
			if (c.state === "pending") {
				const grant = this.#state.grants.find((g) => g.id === c.grantId);
				if ((grant && grant.expires <= this.now()) || (!grant && this.now() - c.created >= 10 * MINUTE)) {
					c.state = "expired";
					changed = true;
				}
			}
		}
		if (changed) this.save();
	}

	close() {
		this.db.close();
	}
	limit(key: string, count: number, window = MINUTE) {
		const now = this.now();
		let entry = this.#limits.get(key);
		if (!entry || now - entry.start >= window) {
			entry = { start: now, count: 0 };
			this.#limits.set(key, entry);
		}
		if (++entry.count > count)
			throw new DeviceAuthError("rate_limited", 429, Math.max(1, Math.ceil((entry.start + window - now) / 1000)));
		if (this.#limits.size > 10000)
			for (const [name, value] of this.#limits) if (now - value.start >= 3600_000) this.#limits.delete(name);
	}
	hostAllowed(origin: string, loopbackOrigins: readonly string[]): boolean {
		return [...this.#state.hosts, ...loopbackOrigins].includes(origin);
	}
	observeHost(origin: string): boolean {
		if (this.#state.observedHosts.includes(origin)) return false;
		if (this.#state.observedHosts.length < 100) {
			this.#state.observedHosts.push(origin);
			this.save();
		}
		return true;
	}
	setMode(value: unknown) {
		this.#state.mode = mode(value);
		if (value === "required") {
			for (const c of this.#state.claims) if (c.grantId === "migration" && c.state === "pending") c.state = "denied";
		}
		this.save();
		this.onAudit?.("mode", this.mode);
		this.onMode?.(this.mode);
		return this.status();
	}
	session(sessionId: string, touch = false): Session {
		const session = this.#state.sessions.find((row) => row.id === sessionId);
		if (!session) return fail();
		if (session.revoked !== null) return fail("auth_revoked", 403);
		if (this.now() >= Math.min(session.created + 365 * DAY, session.lastUsed + 180 * DAY)) return fail("auth_expired");
		if (touch && this.now() - session.lastUsed >= MINUTE) {
			session.lastUsed = this.now();
			this.save();
		}
		return session;
	}
	active(sessionId: string): boolean {
		try {
			this.session(sessionId);
			return true;
		} catch {
			return false;
		}
	}
	authenticate(token: string, touch = true, grace = 0): Identity {
		const parts = /^aiki_a1\.([a-f0-9]{32})\.[A-Za-z0-9_-]{43}$/.exec(token);
		if (!parts) return fail();
		const access = this.#state.access[parts[1]!];
		if (!access || !matches(token, access.hash)) return fail();
		this.session(access.sessionId);
		if (this.now() >= access.expires + grace) return fail("auth_expired");
		if (touch) this.session(access.sessionId, true);
		return { sessionId: access.sessionId, accessExpiresAt: access.expires };
	}
	check(identity: Identity, grace = 0) {
		this.session(identity.sessionId);
		if (this.now() >= identity.accessExpiresAt + grace) return fail("auth_expired");
		this.session(identity.sessionId, true);
	}
	#access(session: Session) {
		const accessId = id(),
			token = `aiki_a1.${accessId}.${randomBytes(32).toString("base64url")}`,
			expires = this.now() + ACCESS_TTL;
		this.#state.access[accessId] = { sessionId: session.id, hash: hash(token), expires };
		return { accessToken: token, accessExpiresAt: new Date(expires).toISOString() };
	}
	#credentials(label: string, platform: string): SessionCredentials {
		const sessionId = id(),
			token = `aiki_s1.${sessionId}.${randomBytes(32).toString("base64url")}`;
		const session: Session = {
			id: sessionId,
			label,
			platform,
			created: this.now(),
			lastUsed: this.now(),
			rotated: this.now(),
			retainedHash: hash(token),
			revoked: null,
		};
		this.#state.sessions.push(session);
		const access = this.#access(session);
		return {
			backendId: this.backendId,
			sessionId,
			sessionToken: token,
			...access,
			sessionExpiresAt: new Date(Math.min(session.created + 365 * DAY, session.lastUsed + 180 * DAY)).toISOString(),
			rotateAfter: new Date(session.rotated + 30 * DAY).toISOString(),
		};
	}
	#retained(token: string, allowPrevious = false): Session {
		const parts = /^aiki_s1\.([a-f0-9]{32})\.[A-Za-z0-9_-]{43}$/.exec(token);
		if (!parts) return fail();
		const session = this.session(parts[1]!);
		if (
			!matches(token, session.retainedHash) &&
			!(
				allowPrevious &&
				session.previousHash &&
				matches(token, session.previousHash) &&
				this.now() < session.rotationUntil!
			)
		)
			return fail();
		this.session(session.id, true);
		return session;
	}
	refresh(token: string, source: string) {
		this.limit(`refresh-source:${source}`, 60);
		this.limit("refresh-global", 300);
		const session = this.#retained(token);
		this.limit(`refresh:${session.id}`, 30);
		const access = this.#access(session);
		this.save();
		return {
			backendId: this.backendId,
			sessionId: session.id,
			...access,
			sessionExpiresAt: new Date(Math.min(session.created + 365 * DAY, session.lastUsed + 180 * DAY)).toISOString(),
			rotateAfter: new Date(session.rotated + 30 * DAY).toISOString(),
		};
	}
	rotate(token: string, successor: string) {
		const session = this.#retained(token, true);
		if (!new RegExp(`^aiki_s1\\.${session.id}\\.[A-Za-z0-9_-]{43}$`).test(successor) || token === successor)
			return fail("bad_request", 400);
		if (matches(token, session.retainedHash)) {
			session.previousHash = session.retainedHash;
			session.retainedHash = hash(successor);
			session.rotationHash = hash(successor);
			session.rotationUntil = this.now() + MINUTE;
			session.rotated = this.now();
		} else if (
			!session.rotationHash ||
			!matches(successor, session.rotationHash) ||
			this.now() >= session.rotationUntil!
		)
			return fail();
		this.save();
		return { sessionId: session.id, rotateAfter: new Date(session.rotated + 30 * DAY).toISOString() };
	}
	devices(current: string | null = null): AuthDevice[] {
		return this.#state.sessions
			.filter((s) => s.revoked === null)
			.map((s) => ({
				id: s.id,
				label: s.label,
				platform: s.platform,
				createdAt: new Date(s.created).toISOString(),
				lastSeenAt: new Date(s.lastUsed).toISOString(),
				connectedCount: this.connected.get(s.id) ?? 0,
				expiresAt: new Date(Math.min(s.created + 365 * DAY, s.lastUsed + 180 * DAY)).toISOString(),
				current: s.id === current,
			}));
	}
	rename(sessionId: string, label: string) {
		this.session(sessionId).label = label;
		this.save();
		this.onChange?.();
	}
	async revoke(sessionId: string) {
		const s = this.#state.sessions.find((s) => s.id === sessionId);
		if (!s) return fail("not_found", 404);
		s.revoked = this.now();
		for (const g of this.#state.grants) if (g.owner === sessionId && g.state === "unused") g.state = "cancelled";
		// Keep the hash until normal expiry so a verified reconnect can distinguish revoked from unknown.
		// Every access lookup consults this now-revoked session row before authorizing.
		for (const c of this.#state.claims) if (c.sessionId === sessionId) delete c.delivery;
		this.save();
		this.onAudit?.("revoke", sessionId);
		await this.onRevoke?.(sessionId);
		this.onChange?.();
	}
	pairing(grant: Grant): AuthPairing {
		const c = this.#state.claims.find((c) => c.id === grant.claimId);
		return {
			id: grant.id,
			expiresAt: new Date(grant.expires).toISOString(),
			confirm: grant.confirm,
			state: grant.state,
			claimId: grant.claimId,
			comparisonCode: c?.code ?? null,
			label: c?.label ?? null,
			platform: c?.platform ?? null,
		};
	}
	pairings(owner: string) {
		return this.#state.grants
			.filter((g) => g.owner === owner && !g.bootstrap && g.expires > this.now())
			.map((g) => this.pairing(g));
	}
	createPairing(owner: string, confirm = true) {
		this.session(owner);
		this.limit(`create:${owner}`, 10, 3600_000);
		if (
			this.#state.grants.filter(
				(g) => g.owner === owner && g.expires > this.now() && (g.state === "unused" || g.state === "claimed"),
			).length >= 5
		)
			return fail("pending_limit", 429);
		const secret = authSecret("aiki_p1"),
			grant: Grant = {
				id: id(),
				owner,
				hash: hash(secret),
				created: this.now(),
				expires: this.now() + 5 * MINUTE,
				confirm,
				state: "unused",
				claimId: null,
			};
		this.#state.grants.push(grant);
		this.save();
		this.onAudit?.("pairing-created", grant.id);
		return { pairing: this.pairing(grant), secret };
	}
	bootstrap(local = false) {
		for (const g of this.#state.grants) if (g.bootstrap && g.state === "unused") g.state = "cancelled";
		const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
		const secret = local ? authSecret("aiki_b1") : Array.from(randomBytes(12), (b) => alphabet[b & 31]).join("");
		const grant: Grant = {
			id: id(),
			owner: null,
			hash: hash(secret),
			created: this.now(),
			expires: this.now() + 10 * MINUTE,
			confirm: false,
			state: "unused",
			claimId: null,
			bootstrap: true,
			local,
			attempts: 0,
		};
		this.#state.grants.push(grant);
		this.save();
		this.onAudit?.("bootstrap-created", grant.id);
		return { requestId: grant.id, secret, expiresAt: new Date(grant.expires).toISOString() };
	}
	enrollmentLimit(grantId: string, source: string) {
		this.limit("enroll-global", 30);
		this.limit(`enroll:${grantId}:${source}`, 5);
	}
	async redeem(
		input: { grantId: string; secret: string; claimId: string; claimSecret: string; label: string; platform: string },
		source: string,
		bootstrap = false,
		local = false,
	) {
		this.enrollmentLimit(input.grantId, source);
		let grant = this.#state.grants.find((g) => g.id === input.grantId && !!g.bootstrap === bootstrap);
		// --local deliberately carries only its capability, not a request ID.
		if (bootstrap && input.grantId === "local")
			grant =
				this.#state.grants.find((g) => g.bootstrap && g.local && matches(input.secret, g.hash)) ??
				this.#state.grants.find((g) => g.bootstrap && g.local && g.state === "unused");
		if (!grant) return fail();
		if (grant.local && !local) return fail();
		if (!matches(input.secret, grant.hash)) {
			if (bootstrap) {
				grant.attempts = (grant.attempts ?? 0) + 1;
				if (grant.attempts >= 5) grant.state = "cancelled";
				this.save();
			}
			return fail();
		}
		const existing = this.#state.claims.find((c) => c.id === input.claimId);
		if (grant.state !== "unused") {
			if (grant.claimId === input.claimId && existing && matches(input.claimSecret, existing.hash))
				return this.claimView(existing);
			return fail("grant_used", 409);
		}
		if (grant.expires <= this.now()) return fail("auth_expired");
		if (existing) return fail("claim_exists", 409);
		if (this.#state.claims.filter((c) => c.state === "pending").length >= 500) return fail("pending_limit", 429);
		// Compute before mutation; recheck after the async digest to make concurrent redemption one-winner.
		const code = await deviceComparisonCode(this.backendId, grant.id, input.claimId, input.claimSecret);
		if (grant.expires <= this.now()) return fail("auth_expired");
		if (grant.state !== "unused" || this.#state.claims.some((c) => c.id === input.claimId))
			return fail("grant_used", 409);
		const claim: Claim = {
			id: input.claimId,
			hash: hash(input.claimSecret),
			grantId: grant.id,
			label: input.label,
			platform: input.platform,
			created: this.now(),
			lastSeen: this.now(),
			source: source === "loopback" ? "loopback" : "network",
			code,
			state: "pending",
		};
		grant.state = "claimed";
		grant.claimId = claim.id;
		this.#state.claims.push(claim);
		if (!grant.confirm) this.issue(claim, grant);
		this.save();
		if (grant.confirm && grant.owner) this.onPairing?.(grant.owner, this.pairing(grant));
		else this.onChange?.();
		return this.claimView(claim);
	}
	#encrypt(credentials: SessionCredentials): string {
		const iv = randomBytes(12),
			cipher = createCipheriv("aes-256-gcm", this.#key, iv),
			body = Buffer.concat([cipher.update(JSON.stringify(credentials)), cipher.final()]);
		return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
	}
	#decrypt(value: string): SessionCredentials {
		const bytes = Buffer.from(value, "base64url"),
			cipher = createDecipheriv("aes-256-gcm", this.#key, bytes.subarray(0, 12));
		cipher.setAuthTag(bytes.subarray(12, 28));
		return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString());
	}
	issue(claim: Claim, grant?: Grant) {
		const credentials = this.#credentials(claim.label, claim.platform);
		claim.state = "approved";
		claim.sessionId = credentials.sessionId;
		this.onAudit?.("session-created", credentials.sessionId);
		claim.delivery = this.#encrypt(credentials);
		claim.deliveryUntil = this.now() + MINUTE;
		if (grant) grant.state = "approved";
	}
	claimView(c: Claim): {
		claimId: string;
		state: Claim["state"] | "expired";
		comparisonCode: string;
		credentials: SessionCredentials | null;
	} {
		const g = this.#state.grants.find((g) => g.id === c.grantId);
		if (c.delivery && this.now() >= c.deliveryUntil!) {
			delete c.delivery;
			this.save();
		}
		const expired =
			(c.state === "pending" && ((g && g.expires <= this.now()) || (!g && this.now() - c.created >= 10 * MINUTE))) ||
			(c.state === "approved" && !c.delivery);
		return {
			claimId: c.id,
			state: expired ? "expired" : c.state,
			comparisonCode: c.code,
			credentials: c.delivery ? this.#decrypt(c.delivery) : null,
		};
	}
	claim(claimId: string, secret: string) {
		const c = this.#state.claims.find((c) => c.id === claimId);
		if (!c || !matches(secret, c.hash)) return fail();
		return c;
	}
	poll(claimId: string, secret: string) {
		const c = this.claim(claimId, secret);
		this.limit(`poll:${claimId}`, 1, 1000);
		return this.claimView(c);
	}
	ack(claimId: string, secret: string) {
		const c = this.claim(claimId, secret);
		if (c.state !== "approved" && c.state !== "acknowledged") return fail("claim_pending", 409);
		delete c.delivery;
		c.state = "acknowledged";
		this.save();
		return { ok: true };
	}
	decide(owner: string, grantId: string, claimId: string, approve: boolean) {
		this.session(owner);
		const g = this.#state.grants.find((g) => g.id === grantId && g.owner === owner && !g.bootstrap);
		if (!g || g.claimId !== claimId) return fail("not_found", 404);
		if (g.expires <= this.now()) return fail("auth_expired");
		if (g.state === (approve ? "approved" : "denied")) return;
		if (g.state !== "claimed") return fail("grant_used", 409);
		const c = this.#state.claims.find((c) => c.id === claimId)!;
		if (approve) this.issue(c, g);
		else {
			c.state = "denied";
			g.state = "denied";
		}
		this.save();
		this.onChange?.();
	}
	cancel(owner: string, grantId: string) {
		const g = this.#state.grants.find((g) => g.id === grantId && g.owner === owner);
		if (!g) return fail("not_found", 404);
		if (g.state === "approved") return fail("grant_used", 409);
		g.state = "cancelled";
		const c = this.#state.claims.find((c) => c.id === g.claimId);
		if (c) c.state = "denied";
		this.save();
	}
	async migration(input: { claimId: string; claimSecret: string; label: string; platform: string }, source: string) {
		if (this.mode !== "optional") return fail("migration_closed", 403);
		this.enrollmentLimit("migration", source);
		const existing = this.#state.claims.find((c) => c.id === input.claimId);
		if (existing) {
			if (existing.grantId !== "migration" || !matches(input.claimSecret, existing.hash)) return fail();
			existing.lastSeen = this.now();
			this.save();
			return this.claimView(existing);
		}
		if (this.#state.claims.filter((c) => c.grantId === "migration" && c.state === "pending").length >= 100)
			return fail("pending_limit", 429);
		const code = await deviceComparisonCode(this.backendId, "migration", input.claimId, input.claimSecret);
		if (this.mode !== "optional" || this.#state.claims.some((c) => c.id === input.claimId))
			return fail("claim_exists", 409);
		const c: Claim = {
			id: input.claimId,
			hash: hash(input.claimSecret),
			grantId: "migration",
			label: input.label,
			platform: input.platform,
			code,
			created: this.now(),
			lastSeen: this.now(),
			source: source === "loopback" ? "loopback" : "network",
			state: "pending",
		};
		this.#state.claims.push(c);
		this.save();
		return this.claimView(c);
	}
	inventory() {
		return this.#state.claims
			.filter((c) => c.grantId === "migration")
			.map((c) => ({
				claimId: c.id,
				comparisonCode: c.code,
				label: c.label,
				platform: c.platform,
				firstSeenAt: new Date(c.created).toISOString(),
				lastSeenAt: new Date(c.lastSeen).toISOString(),
				source: c.source,
				state: this.claimView(c).state,
			}));
	}
	approveMigration(batchId: string, claimIds: string[]) {
		if (!claimIds.length || new Set(claimIds).size !== claimIds.length) return fail("bad_request", 400);
		if (this.mode !== "optional") return fail("migration_closed", 403);
		const previous = this.#state.batches[batchId];
		if (previous) {
			if (JSON.stringify(previous) !== JSON.stringify(claimIds)) return fail("batch_mismatch", 409);
			return { ok: true };
		}
		const claims = claimIds.map((claimId) => {
			const c = this.#state.claims.find((c) => c.id === claimId && c.grantId === "migration" && c.state === "pending");
			if (!c || this.now() - c.created >= 10 * MINUTE) return fail("not_found", 404);
			return c;
		});
		for (const c of claims) this.issue(c);
		this.#state.batches[batchId] = claimIds;
		this.save();
		this.onChange?.();
		return { ok: true };
	}
	hostsList() {
		return { allowed: this.hosts, observed: [...this.#state.observedHosts] };
	}
	hostChange(origin: string, allow: boolean) {
		origin = validateBackendOrigin(origin);
		this.#state.hosts = this.#state.hosts.filter((h) => h !== origin);
		if (allow) this.#state.hosts.push(origin);
		this.save();
		return this.hostsList();
	}
}
export function validateBackendOrigin(value: string): string {
	try {
		const url = new URL(value);
		if (url.origin !== value || !["http:", "https:"].includes(url.protocol) || url.username || url.password)
			return fail("bad_request", 400);
		return url.origin;
	} catch {
		return fail("bad_request", 400);
	}
}
