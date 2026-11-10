import { Lexer, type Token, type Tokens } from "marked";

/** Plain labels and previews, parsed before callers truncate. Never returns HTML or link destinations. */
export function markdownText(source: string): string {
	function text(token: Token): string {
		switch (token.type) {
			case "html": return "";
			case "space": case "br": case "hr": return "\n";
			case "code": case "codespan": return token.text;
			case "list": return `\n${token.items.map(text).join("\n")}\n`;
			case "table": {
				const table = token as Tokens.Table;
				return [table.header, ...table.rows].map(row => row.map(cell => cell.tokens.map(text).join("")).join(" ")).join("\n");
			}
			default: {
				const content = "tokens" in token && token.tokens ? token.tokens.map(text).join("") : "text" in token ? token.text : "";
				return content + (["paragraph", "heading", "blockquote", "list_item"].includes(token.type) ? "\n" : "");
			}
		}
	}
	return Lexer.lex(source).map(text).join("")
		.replace(/&#(x[0-9a-f]+|\d+);|&(amp|lt|gt|quot|apos|nbsp);/gi, (entity, number: string | undefined, name: string | undefined) => {
			if (number) {
				const point = number[0]?.toLowerCase() === "x" ? Number.parseInt(number.slice(1), 16) : Number(number);
				return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
			}
			return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " } as Record<string, string>)[name?.toLowerCase() ?? ""] ?? entity;
		})
		.replace(/\s+/g, " ").trim();
}
