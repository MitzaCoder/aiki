import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_DATABASE_ID, requireDatabaseId } from "../src/database";

/** Local config generation only: no SDK, project discovery, credential access, deployment or network. */
function generate() {
	const args = process.argv.slice(2);
	const flags = new Map<string, string>();
	for (let index = 0; index < args.length; index += 2) {
		const key = args[index],
			value = args[index + 1];
		if (
			!["--database", "--rules", "--existing-indexes"].includes(key) ||
			flags.has(key) ||
			!value ||
			value.startsWith("--")
		) {
			throw new Error();
		}
		flags.set(key, value);
	}
	const databaseId = requireDatabaseId(flags.get("--database") ?? DEFAULT_DATABASE_ID);
	const rules = flags.get("--rules");
	if (!["sole", "shared"].includes(rules ?? "")) throw new Error();
	const existing = flags.get("--existing-indexes");
	if ((rules === "shared") !== Boolean(existing)) throw new Error();
	const root = resolve(import.meta.dir, "..");
	const template = JSON.parse(readFileSync(resolve(root, "firebase.json"), "utf8")) as { functions: unknown };
	const relayIndexes = JSON.parse(readFileSync(resolve(root, "firestore.indexes.json"), "utf8")) as {
		indexes: unknown[];
		fieldOverrides: { collectionGroup: string; fieldPath: string }[];
	};
	let indexesPath = "firestore.indexes.json";
	if (existing) {
		const previous = JSON.parse(readFileSync(resolve(existing), "utf8")) as {
			indexes: unknown[];
			fieldOverrides?: { collectionGroup: string; fieldPath: string }[];
		};
		if (
			!Array.isArray(previous.indexes) ||
			(previous.fieldOverrides !== undefined && !Array.isArray(previous.fieldOverrides))
		)
			throw new Error();
		const groups = new Set(relayIndexes.fieldOverrides.map((field) => field.collectionGroup));
		const remaining = (previous.fieldOverrides ?? []).filter((field) => {
			if (!field || typeof field.collectionGroup !== "string" || typeof field.fieldPath !== "string") throw new Error();
			return !groups.has(field.collectionGroup);
		});
		indexesPath = ".deploy.indexes.json";
		// Preserve every existing composite index, not just non-relay ones: never offer unrelated deletions.
		writeFileSync(
			resolve(root, indexesPath),
			JSON.stringify(
				{ indexes: previous.indexes, fieldOverrides: [...remaining, ...relayIndexes.fieldOverrides] },
				null,
				"\t",
			) + "\n",
			{ mode: 0o600 },
		);
	}
	const config = {
		functions: template.functions,
		firestore: [
			{ database: databaseId, ...(rules === "sole" ? { rules: "firestore.rules" } : {}), indexes: indexesPath },
		],
	};
	writeFileSync(resolve(root, ".deploy.firebase.json"), JSON.stringify(config, null, "\t") + "\n", { mode: 0o600 });
	console.log(
		JSON.stringify({
			config: ".deploy.firebase.json",
			databaseId,
			rules,
			indexes: indexesPath,
			warning:
				rules === "shared"
					? "No rules deployment configured: merge the documented blocks into the existing policy separately"
					: "Deny-all rules are configured: use only for a database solely owned by this relay",
		}),
	);
}
try {
	generate();
} catch {
	console.error(
		"Config not generated: choose --rules sole|shared, a valid --database, and --existing-indexes for shared use; see DEPLOY.md",
	);
	process.exitCode = 1;
}
