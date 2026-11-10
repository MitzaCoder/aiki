/**
 * How a backend's connection reads: one label and one tone, shared by the badge the
 * pages show and the compact dot the projects sidebar's rail shows. Pure, so both
 * stay in step with the client's connection states.
 */
import type { ClientState } from "@aiki/client";

/** A tone for the badge's border and text, or the dot's fill. `muted` is before the first handshake. */
export type ConnectionTone = "ok" | "warn" | "err" | "muted";

export type ConnectionView = {
	label: string;
	tone: ConnectionTone;
	/** The long version, for a tooltip: the server's name, or what went wrong. */
	title?: string;
};

export function connectionView(state: Pick<ClientState, "status" | "attempt" | "error" | "server">): ConnectionView {
	const title = state.error ?? state.server?.name;
	switch (state.status) {
		case "ready":
			return { label: "Connected", tone: "ok", title };
		case "connecting":
			return { label: "Connecting…", tone: "warn", title };
		case "reconnecting":
			return {
				label: state.attempt > 0 ? `Reconnecting (${state.attempt})…` : "Reconnecting…",
				tone: "warn",
				title,
			};
		case "closed":
			return { label: "Offline", tone: "err", title };
		default:
			return { label: "Starting…", tone: "muted", title };
	}
}

/** The classes that paint a connection tone, for a badge's outline and a dot's fill. */
export function connectionBadgeClass(tone: ConnectionTone): string {
	switch (tone) {
		case "ok":
			return "border-emerald-600/40 text-emerald-700 dark:border-emerald-400/40 dark:text-emerald-300";
		case "warn":
			return "border-amber-600/40 text-amber-700 dark:border-amber-400/40 dark:text-amber-300";
		case "err":
			return "border-destructive/40 text-destructive";
		default:
			return "text-muted-foreground";
	}
}

/** The colour a status dot takes for a connection tone. */
export function connectionDotClass(tone: ConnectionTone): string {
	switch (tone) {
		case "ok":
			return "bg-emerald-600 dark:bg-emerald-400";
		case "warn":
			return "bg-amber-500 dark:bg-amber-400";
		case "err":
			return "bg-destructive";
		default:
			return "bg-muted-foreground/50";
	}
}
