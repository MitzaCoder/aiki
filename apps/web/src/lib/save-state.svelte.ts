/**
 * One field's save, as the settings show it: idle, saving, saved (for a moment) or failed with the reason. Each row
 * owns one, so a failure sits beside the field that failed and nothing else on the page changes.
 */
export type SaveStatus = "idle" | "saving" | "saved" | "failed";

/** How long "Saved" stays before the row goes quiet again. */
const SAVED_VISIBLE_MS = 2500;

export class SaveState {
	status = $state<SaveStatus>("idle");
	error = $state<string | undefined>(undefined);
	#timer: ReturnType<typeof setTimeout> | undefined;
	#run = 0;

	/** Runs the save; true when it went through. A newer run supersedes an older one's outcome. */
	async run(action: () => Promise<unknown>): Promise<boolean> {
		const run = ++this.#run;
		clearTimeout(this.#timer);
		this.status = "saving";
		this.error = undefined;
		try {
			await action();
		} catch (failure) {
			if (run === this.#run) {
				this.status = "failed";
				this.error = failure instanceof Error ? failure.message : String(failure);
			}
			return false;
		}
		if (run === this.#run) {
			this.status = "saved";
			this.#timer = setTimeout(() => {
				if (run === this.#run) this.status = "idle";
			}, SAVED_VISIBLE_MS);
		}
		return true;
	}

	/** A problem found before anything was sent, such as a value out of range. */
	fail(message: string): void {
		this.#run += 1;
		clearTimeout(this.#timer);
		this.status = "failed";
		this.error = message;
	}

	reset(): void {
		this.#run += 1;
		clearTimeout(this.#timer);
		this.status = "idle";
		this.error = undefined;
	}
}
