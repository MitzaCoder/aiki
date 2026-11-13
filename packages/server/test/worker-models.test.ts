/**
 * Worker model resolution: which model and thinking level a new worker gets from the coordinator's call, the composer's
 * pick and the project's default worker models, in that order.
 */
import { describe, expect, it } from "bun:test";
import type { Models } from "@earendil-works/pi-ai";
import type { ModelRef, ThinkingLevel, WorkerModel } from "@kemiri/protocol";
import { resolveWorkerModel } from "../src/workers.ts";

const FAUX: ModelRef = { provider: "faux", modelId: "faux-1" };
const OTHER: ModelRef = { provider: "other", modelId: "other-1" };
const UNKNOWN: ModelRef = { provider: "nope", modelId: "nope-1" };

const available = new Set([`${FAUX.provider}/${FAUX.modelId}`, `${OTHER.provider}/${OTHER.modelId}`]);
const models = {
	getModel: (provider: string, modelId: string) =>
		available.has(`${provider}/${modelId}`) ? { provider, modelId } : undefined,
} as unknown as Models;

function resolve(options: {
	explicit?: ModelRef;
	explicitThinkingLevel?: ThinkingLevel;
	defaults?: { model: ModelRef | null; thinkingLevel: ThinkingLevel | null };
	projectModels?: readonly WorkerModel[];
}) {
	return resolveWorkerModel({
		...(options.explicit === undefined ? {} : { explicit: options.explicit }),
		...(options.explicitThinkingLevel === undefined
			? {}
			: { explicitThinkingLevel: options.explicitThinkingLevel }),
		defaults: options.defaults ?? { model: null, thinkingLevel: null },
		projectModels: options.projectModels ?? [],
		models,
	});
}

describe("resolveWorkerModel", () => {
	it("uses the project's first available model and its stored thinking level", () => {
		const result = resolve({
			projectModels: [{ ...UNKNOWN, thinkingLevel: "high" }, { ...FAUX, thinkingLevel: "medium" }],
		});
		expect(result).toEqual({ ok: true, value: { model: FAUX, thinkingLevel: "medium" } });
	});

	it("leaves the level to the model when the list entry has none", () => {
		expect(resolve({ projectModels: [FAUX] })).toEqual({
			ok: true,
			value: { model: FAUX, thinkingLevel: null },
		});
		expect(resolve({ projectModels: [{ ...FAUX, thinkingLevel: null }] })).toEqual({
			ok: true,
			value: { model: FAUX, thinkingLevel: null },
		});
	});

	it("puts the composer's level over the list entry's, for both the picked and the default model", () => {
		const projectModels: WorkerModel[] = [{ ...FAUX, thinkingLevel: "medium" }, { ...OTHER, thinkingLevel: "minimal" }];
		expect(
			resolve({ defaults: { model: FAUX, thinkingLevel: "high" }, projectModels }),
		).toEqual({ ok: true, value: { model: FAUX, thinkingLevel: "high" } });
		// No model picked in the composer: its level still applies to the project's model.
		expect(resolve({ defaults: { model: null, thinkingLevel: "low" }, projectModels })).toEqual({
			ok: true,
			value: { model: FAUX, thinkingLevel: "low" },
		});
	});

	it("uses the stored level for a model the coordinator names, unless it names one", () => {
		const projectModels: WorkerModel[] = [{ ...FAUX, thinkingLevel: "medium" }, { ...OTHER, thinkingLevel: "minimal" }];
		expect(resolve({ explicit: OTHER, projectModels })).toEqual({
			ok: true,
			value: { model: OTHER, thinkingLevel: "minimal" },
		});
		expect(resolve({ explicit: OTHER, explicitThinkingLevel: "max", projectModels })).toEqual({
			ok: true,
			value: { model: OTHER, thinkingLevel: "max" },
		});
		// Not in the list: no stored level to fall back to.
		expect(resolve({ explicit: FAUX, projectModels: [OTHER] })).toEqual({
			ok: true,
			value: { model: FAUX, thinkingLevel: null },
		});
	});

	it("keeps the full order: named level, composer level, list level", () => {
		const projectModels: WorkerModel[] = [{ ...FAUX, thinkingLevel: "medium" }];
		const defaults = { model: OTHER, thinkingLevel: "high" as const };
		expect(resolve({ explicit: FAUX, explicitThinkingLevel: "xhigh", projectModels, defaults })).toEqual({
			ok: true,
			value: { model: FAUX, thinkingLevel: "xhigh" },
		});
		expect(resolve({ explicit: FAUX, projectModels, defaults })).toEqual({
			ok: true,
			value: { model: FAUX, thinkingLevel: "high" },
		});
		expect(resolve({ explicit: FAUX, projectModels, defaults: { model: OTHER, thinkingLevel: null } })).toEqual({
			ok: true,
			value: { model: FAUX, thinkingLevel: "medium" },
		});
	});

	it("refuses a model the backend does not offer and reports when none is set", () => {
		expect(resolve({ explicit: UNKNOWN, projectModels: [FAUX] })).toEqual({
			ok: false,
			message: "Unknown model nope/nope-1.",
		});
		expect(resolve({ projectModels: [UNKNOWN] })).toMatchObject({ ok: false });
	});
});
