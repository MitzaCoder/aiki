/**
 * Copy text to the clipboard. `navigator.clipboard` only exists in secure
 * contexts (HTTPS or localhost), so plain-HTTP access (e.g. over the tailnet)
 * falls back to the legacy `execCommand('copy')`.
 */
export async function copyText(text: string): Promise<boolean> {
	if (navigator.clipboard && window.isSecureContext) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			// Permission denied or document not focused; try the fallback.
		}
	}
	const textarea = document.createElement("textarea");
	textarea.value = text;
	textarea.setAttribute("readonly", "");
	textarea.style.position = "fixed";
	textarea.style.opacity = "0";
	document.body.append(textarea);
	textarea.select();
	try {
		return document.execCommand("copy");
	} finally {
		textarea.remove();
	}
}
