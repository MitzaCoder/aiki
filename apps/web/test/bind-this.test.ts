import { expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";

/**
 * Svelte sets a `bind:this` variable to `null`, not `undefined`, when its element or component goes away
 * (`bind_this` in svelte's `internal/client/dom/elements/bindings/this.js`). A guard like `card !== undefined` then lets
 * `null` through and the next `card.contains(...)` throws, which once stopped every ref card after the first. Compare
 * bound variables with `== null` / `!= null`, or use `?.` / `!x`.
 */
test("no bind:this variable is compared with === or !== undefined", async () => {
	const root = new URL("../src", import.meta.url).pathname;
	const offenders: string[] = [];
	for await (const file of new Glob("**/*.svelte").scan(root)) {
		const source = readFileSync(`${root}/${file}`, "utf8");
		const names = new Set([...source.matchAll(/bind:this=\{([A-Za-z_$][\w$.]*)\}/g)].map((match) => match[1]!));
		for (const name of names) {
			const escaped = name.replace(/[.$]/g, "\\$&");
			const compared = new RegExp(`(?<![\\w$.])${escaped}\\s*[!=]==\\s*undefined|undefined\\s*[!=]==\\s*${escaped}(?![\\w$])`);
			source.split("\n").forEach((line, index) => {
				if (compared.test(line)) offenders.push(`${file}:${index + 1} ${name}: ${line.trim()}`);
			});
		}
	}
	expect(offenders).toEqual([]);
});
