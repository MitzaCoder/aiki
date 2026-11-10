import net from "node:net";
import tls from "node:tls";
import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";
import { mock } from "bun:test";
/** Reject external destinations before a test can accidentally reach a provider or metadata service. */
export function assertLoopback(host: string): void {
	if (!["127.0.0.1", "::1", "[::1]"].includes(host)) throw new Error("Non-loopback network refused");
}
const fetchOriginal = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
	const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
	assertLoopback(url.hostname);
	return fetchOriginal(input, init);
}) as typeof fetch;
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
	const options: unknown = Array.isArray(args[0]) ? args[0][0] : args[0];
	if (options !== null && typeof options === "object") {
		const record = options as Record<string, unknown>;
		if (!record.path) assertLoopback(String(record.host ?? "127.0.0.1"));
	} else if (typeof options === "number") {
		assertLoopback(typeof args[1] === "string" ? args[1] : "127.0.0.1");
	} else {
		throw new Error("Unrecognized connection refused");
	}
	return Reflect.apply(connect, this, args);
} as typeof connect;
const tlsConnect = tls.connect;
tls.connect = ((...args: unknown[]) => {
	const options =
		typeof args[0] === "object" && args[0] !== null ? (args[0] as Record<string, unknown>) : { host: args[1] };
	assertLoopback(String(options.host ?? "127.0.0.1"));
	return Reflect.apply(tlsConnect, tls, args);
}) as typeof tls.connect;
const lookup = dns.lookup;
dns.lookup = ((host: string, ...args: unknown[]) => {
	assertLoopback(host);
	return Reflect.apply(lookup, dns, [host, ...args]);
}) as typeof dns.lookup;
const promiseLookup = dns.promises.lookup;
dns.promises.lookup = ((host: string, ...args: unknown[]) => {
	assertLoopback(host);
	return Reflect.apply(promiseLookup, dns.promises, [host, ...args]);
}) as typeof promiseLookup;
const bunLookup = Bun.dns.lookup;
Bun.dns.lookup = (...args: Parameters<typeof bunLookup>) => {
	assertLoopback(args[0]);
	return bunLookup(...args);
};
// No test needs a DNS query: numeric loopback addresses go through lookup above.
for (const module of [dns, dns.promises]) {
	const exports = module as unknown as Record<string, unknown>;
	for (const key of Object.keys(exports).filter((key) => key.startsWith("resolve") || key === "reverse")) {
		exports[key] = () => {
			throw new Error("Non-loopback DNS query refused");
		};
	}
}
syncBuiltinESMExports();
// Bun does not synchronize DNS named exports. Replace both namespaces before test imports.
const guardedDns = { ...dns, default: dns };
mock.module("node:dns", () => guardedDns);
mock.module("dns", () => guardedDns);
