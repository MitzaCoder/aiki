/**
 * pi-ai `CredentialStore` backed by a 0600 JSON file in the data directory.
 *
 * The file is the same flat `{ [providerId]: Credential }` shape as pi's `auth.json`, so it can be inspected or moved
 * with the usual tools. Only `read()` ever resolves a secret; `list()` returns `{ providerId, type }`.
 */
import type {
	ApiKeyCredential,
	AuthOperationOptions,
	Credential,
	CredentialInfo,
	CredentialStore,
} from "@earendil-works/pi-ai";
import { readJsonFile, writeJsonFile } from "./fs-json.ts";

/** MCP records are isolated from AI providers by the `mcp:` key prefix. The normal
 * OAuth credential already carries access/refresh/expires and extensible grant metadata.
 * Version and URL binding let stage 2 add issuer/registration/refresh without moving secrets. */
export type McpCredential = Credential & { mcp: { version: 1; serverUrl: string; oauth?: import("@earendil-works/pi-mcp/oauth").McpOAuthState } };
type CredentialsFile = Record<string, Credential>;

function isCredential(value: unknown): value is Credential {
	if (typeof value !== "object" || value === null) return false;
	const type = (value as { type?: unknown }).type;
	return type === "api_key" || type === "oauth";
}

export class FileCredentialStore implements CredentialStore {
	readonly path: string;
	/** Every mutation reads and writes the file on this chain, so a modify cannot interleave with a delete. */
	#chain: Promise<unknown> = Promise.resolve();

	constructor(path: string) {
		this.path = path;
	}

	async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
		options?.signal?.throwIfAborted();
		const credentials = await this.#readFile();
		return credentials[providerId];
	}

	async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
		options?.signal?.throwIfAborted();
		const credentials = await this.#readFile();
		return Object.entries(credentials).map(([providerId, credential]) => ({ providerId, type: credential.type }));
	}

	async modify(
		providerId: string,
		fn: (current: Credential | undefined) => Promise<Credential | undefined>,
		options?: AuthOperationOptions,
	): Promise<Credential | undefined> {
		return this.#serialize(options, async () => {
			const credentials = await this.#readFile();
			const current = credentials[providerId];
			const next = await fn(current);
			if (next === undefined) return current;
			if (!isCredential(next)) throw new TypeError("CredentialStore.modify() returned an invalid credential");
			credentials[providerId] = next;
			await writeJsonFile(this.path, credentials, 0o600);
			return next;
		});
	}

	async delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
		await this.#serialize(options, async () => {
			const credentials = await this.#readFile();
			if (!(providerId in credentials)) return;
			delete credentials[providerId];
			await writeJsonFile(this.path, credentials, 0o600);
		});
	}

	/** Store an API key for one provider, replacing any existing credential of that provider. */
	async setApiKey(providerId: string, key: string): Promise<ApiKeyCredential> {
		const trimmed = key.trim();
		if (trimmed.length === 0) throw new TypeError("API key must not be empty");
		const credential: ApiKeyCredential = { type: "api_key", key: trimmed };
		await this.modify(providerId, async () => credential);
		return credential;
	}

	async #readFile(): Promise<CredentialsFile> {
		const value = await readJsonFile(this.path);
		if (value === undefined) return {};
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			throw new Error(`Credentials file ${this.path} is not a JSON object`);
		}
		const credentials: CredentialsFile = {};
		for (const [providerId, credential] of Object.entries(value)) {
			if (isCredential(credential)) credentials[providerId] = credential;
		}
		return credentials;
	}

	#serialize<T>(options: AuthOperationOptions | undefined, work: () => Promise<T>): Promise<T> {
		const run = this.#chain.then(async () => {
			options?.signal?.throwIfAborted();
			return work();
		});
		this.#chain = run.catch(() => undefined);
		return run;
	}
}
