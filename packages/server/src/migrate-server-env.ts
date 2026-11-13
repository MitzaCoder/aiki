import { copyFileSync, constants, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";

/** Only the selected private env file is migrated. Never log values or overwrite its original backup. */
export function migrateServerEnv(file: string, source = readFileSync(file, "utf8"), log: (message: string) => void = console.error): string {
	const parsed = parseEnv(source);
	const names = Object.keys(parsed).filter(name => name.startsWith("AIKI_"));
	if (!names.length) return source;
	const conflicts = names.filter(name => parsed[name.replace(/^AIKI_/, "KEMIRI_")] !== undefined);
	// Find complete dotenv assignments, including multiline quoted values. Preserve all other bytes.
	const assignment = /^(\s*(?:export[ \t]+)?)([A-Za-z_][A-Za-z0-9_]*)([ \t]*=[ \t]*)/gm;
	let cursor = 0, rewritten = "", match: RegExpExecArray | null;
	while ((match = assignment.exec(source))) {
		const start = match.index, valueStart = assignment.lastIndex;
		let end = source.indexOf("\n", valueStart);
		if (end < 0) end = source.length;
		const quote = source[valueStart];
		if (quote === '"' || quote === "'" || quote === "`") {
			const close = source.indexOf(quote, valueStart + 1);
			if (close >= 0) { end = source.indexOf("\n", close + 1); if (end < 0) end = source.length; }
		}
		if (end < source.length) end++;
		const name = match[2]!;
		rewritten += source.slice(cursor, start);
		if (!name.startsWith("AIKI_")) rewritten += source.slice(start, end);
		else if (!conflicts.includes(name)) rewritten += match[1] + name.replace(/^AIKI_/, "KEMIRI_") + match[3] + source.slice(valueStart, end);
		cursor = end;
		assignment.lastIndex = end;
	}
	rewritten += source.slice(cursor);
	const expected: Record<string, string> = {};
	for (const [name, value] of Object.entries(parsed)) {
		const canonical = name.replace(/^AIKI_/, "KEMIRI_");
		expected[canonical] = parsed[canonical] ?? value!;
	}
	const actual = parseEnv(rewritten);
	if (JSON.stringify(Object.entries(expected).sort()) !== JSON.stringify(Object.entries(actual).sort())) throw new Error("Server env migration refused: values would change");
	const temporary = `${file}.incoming-${process.pid}`;
	let backup = `${file}.bak`;
	try {
		if (readFileSync(file, "utf8") !== source) throw new Error("Server env changed during migration; retry startup");
		try { copyFileSync(file, backup, constants.COPYFILE_EXCL); }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			// Preserve a prior backup and this new input, including a losing conflict value.
			if (readFileSync(backup, "utf8") !== source) {
				backup = `${file}.bak-${Date.now()}-${process.pid}`;
				copyFileSync(file, backup, constants.COPYFILE_EXCL);
			}
		}
		writeFileSync(temporary, rewritten, { mode: statSync(file).mode & 0o777, flag: "wx" });
		renameSync(temporary, file);
	} finally { rmSync(temporary, { force: true }); }
	log(`Migrated server.env keys: ${names.join(", ")}; original saved in ${backup.slice(file.length)}`);
	for (const name of conflicts) log(`Dropped ${name}: ${name.replace(/^AIKI_/, "KEMIRI_")} wins`);
	return rewritten;
}
