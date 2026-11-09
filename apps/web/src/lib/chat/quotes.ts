/**
 * Quotes in the chat: text picked out of the transcript goes into a message as Markdown blockquotes before what the
 * user typed, so the coordinator reads exactly what was quoted, and a user message that starts with blockquotes shows
 * them as quotes again. Plain text throughout: a quote is what the selection reads, not the rendered HTML.
 */

/** A selection's text as a quote: no-break spaces as spaces, no trailing spaces or outer blank lines, at most one blank line in a row. */
export function quoteFromSelection(selected: string): string {
	return selected
		.replace(/\r\n?/g, "\n")
		.replace(/\u00a0/g, " ")
		.replace(/[ \t]+$/gm, "")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/^\n+|\n+$/g, "");
}

/** Where a selection edge sits: the text of the node it is in, and its offset there. */
export interface SelectionEdge {
	text: string;
	offset: number;
}

const WORD_BEFORE = /[\p{L}\p{M}\p{N}_]+$/u;
const WORD_AFTER = /^[\p{L}\p{M}\p{N}_]+/u;

/** The two parts of the word an edge falls inside, or undefined when it sits between words. */
function cutWord({ text, offset }: SelectionEdge): { before: string; after: string } | undefined {
	const before = WORD_BEFORE.exec(text.slice(0, offset))?.[0] ?? "";
	const after = WORD_AFTER.exec(text.slice(offset))?.[0] ?? "";
	return before.length > 0 && after.length > 0 ? { before, after } : undefined;
}

/**
 * A selection's text with an edge that falls inside a word moved out to the whole word, so a hand selection starting
 * at "his paragraph" quotes "This paragraph". Only the text of the edge's own node is read, which never reaches past
 * its block, and a word stops at whitespace, so nothing from the next line comes along. An edge outside a text node is
 * `undefined` and stays where it is.
 */
export function selectionInWholeWords(
	selected: string,
	start: SelectionEdge | undefined,
	end: SelectionEdge | undefined,
): string {
	const head = start === undefined ? "" : (cutWord(start)?.before ?? "");
	const tail = end === undefined ? "" : (cutWord(end)?.after ?? "");
	return head + selected + tail;
}

/** One quote as a Markdown blockquote, every line kept; a blank line inside it stays in the quote as `>`. */
function blockquote(quote: string): string {
	return quote
		.split("\n")
		.map((line) => (line.length === 0 ? ">" : `> ${line}`))
		.join("\n");
}

/** The text a message sends: each quote as its own blockquote, then what was typed, separated by blank lines. */
export function messageWithQuotes(quotes: readonly string[], text: string): string {
	const blocks = quotes.filter((quote) => quote.trim().length > 0).map(blockquote);
	const typed = text.trim();
	if (typed.length > 0) blocks.push(typed);
	return blocks.join("\n\n");
}

/**
 * A message cut into the blockquotes it starts with and the text after them. Consecutive `>` lines are one quote and
 * a blank line starts the next; one level of `>` comes off, so a quoted quote keeps its own. A message that does not
 * start with `>` has no quotes.
 */
export function splitQuotes(message: string): { quotes: string[]; text: string } {
	const lines = message.split("\n");
	const quotes: string[] = [];
	let current: string[] | undefined;
	let index = 0;
	for (; index < lines.length; index++) {
		const line = lines[index] as string;
		const quoted = /^ {0,3}>/.exec(line);
		if (quoted !== null) {
			current ??= [];
			current.push(line.slice(quoted[0].length).replace(/^ /, ""));
		} else if (line.trim().length === 0 && quotes.length + (current === undefined ? 0 : 1) > 0) {
			if (current !== undefined) quotes.push(current.join("\n"));
			current = undefined;
		} else break;
	}
	if (current !== undefined) quotes.push(current.join("\n"));
	if (quotes.length === 0) return { quotes: [], text: message };
	return { quotes, text: lines.slice(index).join("\n").trim() };
}

/** A quote's first line with text, its whitespace collapsed: what a chip shows of it. */
export function quotePreview(quote: string): string {
	const line = quote.split("\n").find((candidate) => candidate.trim().length > 0) ?? "";
	return line.replace(/\s+/g, " ").trim();
}
