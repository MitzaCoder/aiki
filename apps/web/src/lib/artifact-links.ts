/** Navigation choices for an untrusted, opaque-origin artifact document. */
export type ArtifactLinkDecision =
	| { kind: "scroll"; id: string }
	| { kind: "open" | "mailto" | "tel"; url: string }
	| { kind: "block" };

/** Self-contained: this exact function is also serialized into the sandbox prelude. */
export function artifactLinkDecision(href: string, baseUrl: string): ArtifactLinkDecision {
	const link = href.trim();
	if (link.startsWith("#")) {
		try { return { kind: "scroll", id: decodeURIComponent(link.slice(1)) }; }
		catch { return { kind: "block" }; }
	}
	try {
		const url = new URL(link, baseUrl);
		if (url.protocol === "http:" || url.protocol === "https:") return { kind: "open", url: url.href };
		if (url.protocol === "mailto:") return { kind: "mailto", url: url.href };
		if (url.protocol === "tel:") return { kind: "tel", url: url.href };
	} catch { /* Relative links without an author base have no origin to resolve against. */ }
	return { kind: "block" };
}

/** Runs only inside the artifact; never receives a host window or an app capability. */
function installArtifactLinks(decide: typeof artifactLinkDecision): void {
	document.addEventListener("click", (event) => {
		// Enter on a focused anchor generates this same click. Do not double-handle keydown.
		if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		const anchor = event.composedPath().find((node) => node instanceof Element && node.matches("a[href]")) as Element | undefined;
		if (!anchor) return;
		// srcdoc inherits the host's base URI even though it has an opaque origin. Only an author base
		// may resolve relative links; never accidentally turn them into links to the app's own routes.
		const base = document.querySelector<HTMLBaseElement>("base[href]")?.href ?? location.href;
		const decision = decide(anchor.getAttribute("href") ?? "", base);
		event.preventDefault();
		if (decision.kind === "scroll") {
			if (!decision.id) window.scrollTo(0, 0);
			else (document.getElementById(decision.id) ?? document.getElementsByName(decision.id)[0])?.scrollIntoView();
		} else if (decision.kind !== "block") {
			// Ignore target (including <base target>): never replace the artifact or navigate its parent.
			window.open(decision.url, "_blank", "noopener");
			if (decision.kind === "mailto" || decision.kind === "tel") {
				// noopener returns null even on success, and protocol-handler availability is not observable.
				// Keep an address to copy on systems without a mail/dial handler, including headless browsers.
				document.getElementById("aiki-artifact-contact")?.remove();
				const panel = document.createElement("div");
				panel.id = "aiki-artifact-contact";
				panel.setAttribute("role", "status");
				panel.style.cssText = "position:fixed;left:12px;right:12px;bottom:64px;z-index:2147483647;padding:12px;background:var(--tone-surface,#fff);color:var(--tone-fg,#111);border:1px solid var(--tone-border,#ccc);font:14px/1.5 system-ui";
				const label = document.createElement("label");
				label.textContent = "If no app opened, copy this address: ";
				const address = document.createElement("input");
				address.readOnly = true;
				address.value = decision.url.replace(/^(mailto:|tel:)/i, "");
				address.style.cssText = "width:min(100%,32rem);color:inherit;background:transparent";
				address.onclick = () => address.select();
				label.appendChild(address);
				const close = document.createElement("button");
				close.type = "button";
				close.textContent = "Close";
				close.onclick = () => panel.remove();
				panel.append(label, close);
				document.body.appendChild(panel);
			}
		}
	}, true);
}

/** Function bodies contain no author data; author HTML never enters the host DOM. */
export const ARTIFACT_LINK_PRELUDE = `(${installArtifactLinks.toString()})(${artifactLinkDecision.toString()});`;
