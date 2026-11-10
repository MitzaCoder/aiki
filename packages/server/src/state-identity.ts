import { serverSettings } from "./server-settings.ts";
/** Stable on-disk document and task identity; configure once before opening an existing installation. */
export function stateKind(suffix: string): string {
	return `${serverSettings.AIKI_STATE_NAMESPACE || "aiki"}.${suffix}`;
}
