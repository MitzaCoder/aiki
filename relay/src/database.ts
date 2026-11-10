export const DEFAULT_DATABASE_ID = "(default)";

/** Firestore database IDs, not paths; reject UUID-shaped names as the service does. */
export function requireDatabaseId(input: string): string {
	if (input === DEFAULT_DATABASE_ID) return input;
	if (!/^[a-z][a-z0-9-]{2,61}[a-z0-9]$/.test(input) || /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(input))
		throw new Error("Invalid database ID");
	return input;
}
