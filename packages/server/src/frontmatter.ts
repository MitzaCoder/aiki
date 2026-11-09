/**
 * The slice of YAML a `SKILL.md` declares in its frontmatter: `name` and `description`. That is the only YAML this
 * server reads, so it parses it itself instead of taking a dependency: flat `key: value` pairs, optionally quoted, and
 * the block scalars (`|`, `>`) an agent skill uses for a long description. Anything nested is ignored.
 */

export type Frontmatter = Record<string, string>;

const KEY_VALUE = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*:\s*(.*)$/;

function unquote(value: string): string {
	const trimmed = value.trim();
	if (trimmed.length < 2) return trimmed;
	const first = trimmed[0];
	const last = trimmed[trimmed.length - 1];
	if ((first === '"' && last === '"') || (first === "'" && last === "'")) return trimmed.slice(1, -1);
	return trimmed;
}

/** Indentation width of a line, counting a tab as one column; only comparisons between the lines matter. */
function indentOf(line: string): number {
	return line.length - line.trimStart().length;
}

/** The lines of a block scalar (`|` or `>`), dedented and joined the way YAML folds them. */
function blockScalar(lines: readonly string[], folded: boolean): string {
	const indents = lines.filter((line) => line.trim().length > 0).map(indentOf);
	const indent = indents.length === 0 ? 0 : Math.min(...indents);
	const dedented = lines.map((line) => line.slice(indent).trimEnd());
	if (folded) {
		// `>` folds single newlines into spaces and keeps blank lines as paragraph breaks.
		const paragraphs: string[][] = [[]];
		for (const line of dedented) {
			if (line.trim().length === 0) paragraphs.push([]);
			else paragraphs[paragraphs.length - 1]!.push(line.trim());
		}
		return paragraphs.map((paragraph) => paragraph.join(" ")).join("\n\n").trim();
	}
	return dedented.join("\n").trim();
}

/**
 * The frontmatter of a markdown file and its body. A file without frontmatter has an empty frontmatter and the whole
 * text as its body; unterminated frontmatter is treated the same way.
 */
export function parseFrontmatter(text: string): { frontmatter: Frontmatter; body: string } {
	const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	const lines = normalized.split("\n");
	if (lines[0]?.trim() !== "---") return { frontmatter: {}, body: normalized };
	const end = lines.findIndex((line, index) => index > 0 && (line.trim() === "---" || line.trim() === "..."));
	if (end === -1) return { frontmatter: {}, body: normalized };

	const frontmatter: Frontmatter = {};
	for (let index = 1; index < end; index++) {
		const line = lines[index]!;
		if (line.trim().length === 0 || line.trimStart().startsWith("#")) continue;
		const match = KEY_VALUE.exec(line);
		if (match === null) continue;
		const key = match[1]!;
		const value = match[2]!.trim();
		if (value.startsWith("|") || value.startsWith(">")) {
			const block: string[] = [];
			while (index + 1 < end && (lines[index + 1]!.trim().length === 0 || indentOf(lines[index + 1]!) > 0)) {
				index++;
				block.push(lines[index]!);
			}
			frontmatter[key] = blockScalar(block, value.startsWith(">"));
			continue;
		}
		frontmatter[key] = unquote(value);
	}
	return { frontmatter, body: lines.slice(end + 1).join("\n").trim() };
}
