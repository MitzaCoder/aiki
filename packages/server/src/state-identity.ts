/** Stable on-disk document and task identity; configure once before opening an existing installation. */
export function stateKind(suffix: string): string {
	return `${process.env.AIKI_STATE_NAMESPACE || "aiki"}.${suffix}`;
}
