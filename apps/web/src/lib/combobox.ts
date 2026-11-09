/**
 * The searchable list behind a settings combobox: options with an optional group, filtered by what the user types.
 * Pure, so the filter and the keyboard order can be tested without a component.
 */

export type ComboOption = {
	/** What the field stores; unique in the list. An empty string is allowed for a "none" choice. */
	value: string;
	label: string;
	/** A second line under the label: an ID, a context size. */
	description?: string;
	/** Group key; options without one sit in an unnamed group first. */
	group?: string;
	/** What the group's heading says; defaults to the key. */
	groupLabel?: string;
	/** More words the search matches that the row does not show. */
	keywords?: string;
	/** A small chip on the right: "no credential", "subscription". */
	badge?: string;
	/** `warn` paints the chip with the theme's warning tone. */
	badgeTone?: "warn" | "ok";
	disabled?: boolean;
};

export type ComboGroup = {
	id: string;
	/** Undefined for the unnamed group, which has no heading. */
	label: string | undefined;
	options: ComboOption[];
};

/** Every word typed must appear in the option's label, description, group or keywords (any case). */
export function matchesQuery(option: ComboOption, query: string): boolean {
	const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 0);
	if (words.length === 0) return true;
	const haystack =
		`${option.label} ${option.description ?? ""} ${option.groupLabel ?? option.group ?? ""} ${option.keywords ?? ""}`.toLowerCase();
	return words.every((word) => haystack.includes(word));
}

/** The options that match, in groups ordered as the groups first appear in the list. */
export function filterOptions(options: readonly ComboOption[], query = ""): ComboGroup[] {
	const groups = new Map<string, ComboGroup>();
	for (const option of options) {
		if (!matchesQuery(option, query)) continue;
		const id = option.group ?? "";
		let group = groups.get(id);
		if (group === undefined) {
			group = { id, label: option.group === undefined ? undefined : (option.groupLabel ?? option.group), options: [] };
			groups.set(id, group);
		}
		group.options.push(option);
	}
	return [...groups.values()];
}

/** The rows in the order the keyboard walks them: disabled ones are skipped. */
export function selectable(groups: readonly ComboGroup[]): ComboOption[] {
	return groups.flatMap((group) => group.options).filter((option) => !option.disabled);
}

/** The index after a key press, wrapping at both ends; -1 means nothing is active yet. */
export function moveActive(current: number, count: number, key: "next" | "previous" | "first" | "last"): number {
	if (count === 0) return -1;
	switch (key) {
		case "first":
			return 0;
		case "last":
			return count - 1;
		case "next":
			return current < 0 ? 0 : (current + 1) % count;
		case "previous":
			return current <= 0 ? count - 1 : current - 1;
	}
}
