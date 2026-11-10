#!/usr/bin/env bun
/** Check the current source snapshot before a public push. Never scan/publish private ancestors or local config. */
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export function publicFileProblems(path: string, bytes: Uint8Array, privateTerms: string[]): string[] {
	const text = new TextDecoder().decode(bytes);
	// The license's single copyright notice is the sole personal-name exception. No other line is exempt.
	const checkedText = path === "LICENSE" ? text.replace(/^Copyright \(c\) 2026 [\p{L} .'-]+$/mu, "Copyright notice") : text;
	const lower = `${path}\n${checkedText}`.toLowerCase();
	const problems: string[] = [];
	for (const [index, term] of privateTerms.entries()) {
		const value = term.trim().toLowerCase();
		const needle = value.startsWith("word:") ? value.slice(5) : value;
		const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const matches = value.startsWith("word:") ? new RegExp(`\\b${escaped}\\b`).test(lower) : lower.includes(needle);
		if (needle && matches) problems.push(`private denylist entry ${index + 1}`);
	}
	if (/\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2}\b/.test(text)) problems.push("private-network address");
	if (/\/(?:home|Users)\/(?!user(?:[\/\s"'`]|$)|me(?:[\/\s"'`]|$)|you(?:[\/\s"'`]|$)|someone(?:[\/\s"'`]|$)|u(?:[\/\s"'`]|$)|meme(?:[\/\s"'`]|$)|example(?:[\/\s"'`]|$))[a-zA-Z][\w.-]+\//.test(text)) {
		problems.push("personal absolute home path");
	}
	if (/(?:^|\/)(?:credentials\.json|vapid\.json|fcm-service-account\.json|google-services\.json|cookies\.(?:json|txt)|push-relay(?:-counters)?\.json|\.netrc|\.npmrc)$/.test(path)
		|| /\.(?:pem|key|keystore|jks|p12|pfx)$/.test(path)
		|| /(?:^|\/)\.env(?:\.[^/]*)?$/.test(path) && !/\.example$/.test(path)) problems.push("secret-bearing filename");
	return problems;
}

async function main(): Promise<void> {
	const root = resolve(import.meta.dir, "..");
	const args = process.argv.slice(2);
	if (args.some((arg) => arg !== "--require-scanner" && !arg.startsWith("--denylist="))) throw new Error("Usage: bun scripts/check-public.ts [--require-scanner] [--denylist=<private file>]");
	const denylist = args.find((arg) => arg.startsWith("--denylist="))?.slice("--denylist=".length)
		|| join(process.env.DEPLOY_CONFIG_DIR || join(root, "deploy/local"), "denylist.txt");
	let terms: string[];
	try { terms = readFileSync(denylist, "utf8").split(/\r?\n/).filter((line) => line.trim() && !line.startsWith("#")); }
	catch { throw new Error("Private denylist missing; configure deploy/local/denylist.txt (never commit its contents)."); }
	if (!terms.length) throw new Error("Private denylist must contain at least one term.");
	const listing = Bun.spawnSync(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root });
	if (listing.exitCode !== 0) throw new Error("Cannot enumerate source files.");
	const paths = [...new Set(listing.stdout.toString().split("\0").filter(Boolean))];
	const stage = await mkdtemp(join(tmpdir(), "aiki-public-check-"));
	let checked = 0;
	try {
		const findings: string[] = [];
		for (const path of paths) {
			const source = join(root, path);
			let stat;
			try { stat = lstatSync(source); } catch { continue; } // Deleted tracked files do not enter a fresh snapshot.
			const bytes = stat.isSymbolicLink() ? new TextEncoder().encode(readlinkSync(source)) : readFileSync(source);
			for (const problem of publicFileProblems(path, bytes, terms)) findings.push(`${path}: ${problem}`);
			// Copy bytes, never dereference a symlink into private data or a workspace's .git pointer.
			const target = join(stage, path);
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, bytes);
			checked++;
		}
		if (findings.length) throw new Error(`Public tree check failed (${findings.length} findings):\n${findings.join("\n")}`);
		console.log(`Public tree denylist and generic checks pass: ${checked} files, ${terms.length} private terms. Values withheld.`);
		const scanArgs = ["dir", stage, "--redact", "--no-banner"];
		const command = Bun.which("gitleaks") ? ["timeout", "120s", "gitleaks", ...scanArgs]
			: Bun.which("nix") ? ["timeout", "120s", "nix", "run", "nixpkgs#gitleaks", "--", ...scanArgs] : null;
		if (command === null) {
			if (args.includes("--require-scanner")) throw new Error("Gitleaks/Nix unavailable; a scanner is required.");
			console.warn("Gitleaks/Nix unavailable: scanner not run. Install it before publishing.");
		} else {
			const child = Bun.spawn(command, { cwd: root, stdout: "inherit", stderr: "inherit" });
			if (await child.exited !== 0) throw new Error("Gitleaks failed or timed out; review redacted output before publishing.");
		}
	} finally { await rm(stage, { recursive: true, force: true }); }
}

if (import.meta.main) await main().catch((error) => { console.error(error.message); process.exitCode = 1; });
