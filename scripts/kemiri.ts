#!/usr/bin/env bun
/** Canonical source CLI; aiki.ts remains the pilot.3 source-archive entry. */
export * from "./aiki.ts";
import { runInstalledCli } from "./aiki.ts";
if (import.meta.main) {
	try { await runInstalledCli(process.argv.slice(2)); }
	catch (error) { console.error(`kemiri: ${error instanceof Error ? error.message : error}`); process.exitCode = 1; }
}
