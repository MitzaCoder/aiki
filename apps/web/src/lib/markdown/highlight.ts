/**
 * Shiki highlighting, loaded on demand.
 *
 * Code is highlighted with a light and a dark theme at once (CSS picks one per
 * `.dark`), and the highlighter only loads the grammars transcripts actually
 * use. The JavaScript regex engine keeps the bundle small; unknown languages
 * fall back to plain text instead of throwing.
 */
import type { BundledLanguage, HighlighterGeneric } from "shiki";

export const LIGHT_THEME = "catppuccin-latte";
export const DARK_THEME = "catppuccin-mocha";

type Highlighter = HighlighterGeneric<BundledLanguage, typeof LIGHT_THEME | typeof DARK_THEME>;

const ALIASES: Record<string, string> = {
	sh: "bash",
	shell: "bash",
	zsh: "bash",
	console: "bash",
	js: "javascript",
	ts: "typescript",
	py: "python",
	rb: "ruby",
	yml: "yaml",
	md: "markdown",
	rs: "rust",
	kt: "kotlin",
	"c++": "cpp",
	jsonl: "json",
	text: "plaintext",
	txt: "plaintext",
	plain: "plaintext",
};

let highlighter: Promise<Highlighter> | undefined;
const loading = new Map<string, Promise<boolean>>();

function getHighlighter(): Promise<Highlighter> {
	highlighter ??= (async () => {
		const [{ createHighlighter }, { createJavaScriptRegexEngine }] = await Promise.all([
			import("shiki"),
			import("shiki/engine/javascript"),
		]);
		return createHighlighter({
			themes: [LIGHT_THEME, DARK_THEME],
			langs: [],
			engine: createJavaScriptRegexEngine({ forgiving: true }),
		}) as Promise<Highlighter>;
	})();
	return highlighter;
}

export function normalizeLang(lang: string | undefined): string {
	const name = (lang ?? "").trim().split(/\s+/)[0].toLowerCase();
	return ALIASES[name] ?? (name || "plaintext");
}

async function ensureLanguage(highlighter: Highlighter, lang: string): Promise<boolean> {
	if (lang === "plaintext" || highlighter.getLoadedLanguages().includes(lang)) return true;
	let pending = loading.get(lang);
	if (!pending) {
		const { bundledLanguages } = await import("shiki");
		pending =
			lang in bundledLanguages
				? highlighter.loadLanguage(lang as BundledLanguage).then(
						() => true,
						() => false,
					)
				: Promise.resolve(false);
		loading.set(lang, pending);
	}
	return pending;
}

/** Highlight code with both themes; the CSS variables switch with `.dark`. */
export async function highlight(code: string, lang: string | undefined): Promise<string> {
	const instance = await getHighlighter();
	const name = normalizeLang(lang);
	const known = await ensureLanguage(instance, name);
	return instance.codeToHtml(code, {
		lang: known ? name : "plaintext",
		themes: { light: LIGHT_THEME, dark: DARK_THEME },
		defaultColor: false,
	});
}
