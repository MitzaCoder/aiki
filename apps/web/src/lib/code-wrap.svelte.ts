/** The reader's "wrap code" choice, shared by every code block and remembered in this browser. */
import { CODE_WRAP_STORAGE_KEY, effectiveWrap, loadCodeWrap, parseCodeWrap, saveCodeWrap, type CodeWrapPreference } from "./code-wrap.ts";

const storage = typeof localStorage === "undefined" ? undefined : localStorage;

class CodeWrap {
	preference = $state<CodeWrapPreference>(loadCodeWrap(storage));

	constructor() {
		// Another tab's choice applies here too.
		if (typeof addEventListener === "function") {
			addEventListener("storage", (event) => {
				if (event.key === CODE_WRAP_STORAGE_KEY) this.preference = parseCodeWrap(event.newValue);
			});
		}
	}

	wraps(defaultWrap: boolean): boolean {
		return effectiveWrap(this.preference, defaultWrap);
	}

	toggle(defaultWrap: boolean): void {
		this.preference = this.wraps(defaultWrap) ? "scroll" : "wrap";
		saveCodeWrap(storage, this.preference);
	}
}

export const codeWrap = new CodeWrap();
