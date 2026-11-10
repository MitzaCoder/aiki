/** Headless Chromium integration/proof driver. See push-browser.md. Every CDP call has a bounded timeout. */
import { strict as assert } from "node:assert";
import { mkdir } from "node:fs/promises";
import { connectChromiumPage } from "./chromium-page.ts";
import {
	browserPushState,
	seedPushBrowser,
	clickPushButton,
	seedPreviousBetaKey,
	markBetaPushExpired,
	showBackendPushSettings,
} from "./push-browser-page.ts";
import { pushBrowserStub, type PushFixture } from "./push-browser-stub.ts";
type FixtureDevice = { deviceId: string; sessionId?: string; subscription: { endpoint: string } };
const origin = "http://127.0.0.1:4198";
const cdp = process.env.PUSH_TEST_CDP ?? "http://127.0.0.1:9298";
const fixture: PushFixture = await fetch(origin + "/fixture.json", { signal: AbortSignal.timeout(3000) }).then(
	(response) => response.json(),
);
const page = await connectChromiumPage(cdp);
const call = page.call.bind(page);
const evaluate = page.evaluate.bind(page);
async function settled(): Promise<void> {
	await evaluate("new Promise(resolve => setTimeout(resolve, 700))");
}
async function button(label: string, index = 0): Promise<void> {
	await page.run(clickPushButton, label, index);
	await settled();
}
function state() {
	return page.run(browserPushState);
}
async function navigate(seed: boolean, scenario: string, legacy = false): Promise<void> {
	await call("Page.enable");
	await call("Page.addScriptToEvaluateOnNewDocument", { source: pushBrowserStub(fixture) });
	if (seed) {
		await call("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
		await call("Page.navigate", { url: origin + "/fixture-blank" });
		await settled();
		await page.run(seedPushBrowser, fixture, scenario, legacy, process.env.PUSH_TEST_LEGACY_PREFIX ?? "");
	}
	await call("Page.navigate", { url: origin + "/settings/notifications" });
	await settled();
}
const [mode, ...args] = process.argv.slice(2);
try {
	if (mode === "init") {
		await navigate(true, args[0] ?? "mixed", args.includes("legacy"));
		console.log("Fixture initialized (required device sign-in, synthetic retained sessions in IndexedDB).");
	} else if (mode === "reload") {
		await navigate(false, "mixed");
		console.log("Reloaded with the existing root/scoped subscriptions.");
	} else if (mode === "enable") {
		await evaluate(`document.querySelector('#notifications-enabled').click()`);
		await settled();
		console.log("Enabled through Notifications settings.");
	} else if (mode === "assert-mixed") {
		const s = await state();
		assert.equal(s.subscribes, args.includes("legacy") ? 1 : 2);
		assert.equal(s.unsubscribes, 0);
		assert.equal(s.scopes.length, 2);
		assert.equal(s.records.alpha.scope, "/");
		assert.equal(s.records.gamma.scope, "/");
		assert.match(s.records.beta.scope, /^\/push\/[a-f0-9]{64}\/$/);
		assert.equal(s.subscriptions[origin + "/"].key, fixture.publicKeys[0]);
		assert.equal(s.subscriptions[origin + s.records.beta.scope].key, fixture.publicKeys[1]);
		const rows = (await fetch(origin + "/registrations.json", { signal: AbortSignal.timeout(3000) }).then((r) =>
			r.json(),
		)) as { devices: FixtureDevice[] }[];
		for (let i = 0; i < 3; i++) {
			const matchingRows = rows[i].devices.filter((device) => device.deviceId === "synthetic-push-browser");
			assert.equal(matchingRows.length, 1);
			const record = s.records[fixture.backends[i]!.id];
			assert.equal(matchingRows[0].subscription.endpoint, s.subscriptions[origin + record.scope].endpoint);
			assert.ok(matchingRows[0].sessionId, "registration belongs to the signed-in session");
		}
		assert.match(s.text, /On \(own subscription\)/);
		assert.match(s.text, /On \(shared subscription\)/);
		assert.doesNotMatch(s.text, /Key mismatch|Unavailable/);
		assert.doesNotMatch(s.text, /\blegacy\b|\bVAPID\b|\bscope\b/i);
		if (args.includes("legacy"))
			assert.equal(s.subscriptions[origin + "/"].endpoint, fixture.pushOrigin + "/legacy-untouched");
		console.log(
			"PASS: 3 authenticated rows use their own key/endpoint; shared pair uses root; separate scopes; no unsubscribe.",
		);
	} else if (mode === "assert-independent") {
		const s = await state();
		assert.equal(s.subscribes, 2);
		assert.equal(s.scopes.length, 3);
		assert.notEqual(s.records.alpha.scope, "/");
		assert.notEqual(s.records.beta.scope, "/");
		assert.notEqual(s.records.alpha.scope, s.records.beta.scope);
		assert.equal(s.subscriptions[origin + "/"], undefined);
		const alphaScope = s.records.alpha.scope;
		await button("Disable push", 1);
		const after = await state();
		assert.ok(after.scopes.includes(alphaScope));
		assert.equal(after.scopes.length, 2);
		assert.deepEqual(after.subscriptions[origin + alphaScope], s.subscriptions[origin + alphaScope]);
		console.log(
			"PASS: two independent keys use two push-only registrations, separate from root; disabling one preserves the other.",
		);
	} else if (mode === "test-delivery") {
		const s = await state();
		for (let i = 0; i < 3; i++) await button("Send a test", i);
		const pushes = await fetch(origin + "/pushes.json", { signal: AbortSignal.timeout(3000) }).then((response) =>
			response.json(),
		);
		const last = (pushes as { publicKey: string; endpoint: string }[]).slice(-3);
		assert.equal(last.length, 3);
		for (let i = 0; i < 3; i++) {
			assert.equal(last[i].publicKey, fixture.publicKeys[i]);
			assert.equal(last[i].endpoint, s.subscriptions[origin + s.records[fixture.backends[i]!.id].scope].endpoint);
		}
		console.log("PASS: fake loopback push service receives each endpoint with that backend’s VAPID signing key.");
	} else if (mode === "assert-operator") {
		const s = await state();
		assert.equal(s.subscribes, 0);
		assert.equal(s.unsubscribes, 0);
		assert.deepEqual(s.scopes, ["/"]);
		assert.equal(Object.keys(s.records).length, 3);
		assert.ok(Object.values(s.records).every((record) => record.scope === "/"));
		assert.equal(s.subscriptions[origin + "/"].endpoint, fixture.pushOrigin + "/legacy-untouched");
		assert.doesNotMatch(s.text, /Needs re-subscribe|Key mismatch|Unavailable|Needs sync/);
		console.log(
			"PASS: operator regression — three backends, one shared key, existing root: no new registration, no re-subscribe, no error.",
		);
	} else if (mode === "disable-beta") {
		const before = await state();
		await button("Disable push", 1);
		const after = await state();
		assert.deepEqual(after.scopes, ["/"]);
		assert.equal(after.records.beta.enabled, false);
		assert.deepEqual(after.subscriptions[origin + "/"], before.subscriptions[origin + "/"]);
		assert.equal(after.unsubscribes, before.unsubscribes + 1);
		console.log("PASS: disabling Beta unregisters only its worker and subscription.");
	} else if (mode === "enable-beta") {
		const before = await state();
		await button("Enable push");
		const after = await state();
		assert.equal(after.scopes.length, 2);
		assert.equal(after.subscribes, before.subscribes + 1);
		assert.deepEqual(after.subscriptions[origin + "/"], before.subscriptions[origin + "/"]);
		console.log("PASS: enabling Beta restores only its own scope.");
	} else if (mode === "key-change") {
		await page.run(seedPreviousBetaKey, fixture.publicKeys[0]!);
		await navigate(false, "mixed");
		console.log("Seeded a previously saved Beta key that differs from its advertised key.");
	} else if (mode === "repair-beta") {
		const before = await state();
		assert.match(before.text, /Needs re-subscribe/);
		assert.equal(before.subscribes, await evaluate(`Number(localStorage.getItem('demo-before-key-change'))`));
		await button("Re-subscribe");
		const after = await state();
		assert.equal(after.subscribes, before.subscribes + 1);
		assert.equal(after.unsubscribes, before.unsubscribes + 1);
		assert.deepEqual(after.subscriptions[origin + "/"], before.subscriptions[origin + "/"]);
		assert.doesNotMatch(after.text, /Needs re-subscribe/);
		console.log("PASS: key change waits for an explicit Beta-only re-subscribe, leaving root untouched.");
	} else if (mode === "sync-beta") {
		const before = await state();
		await page.run(markBetaPushExpired);
		await settled();
		const after = await state();
		assert.equal(after.subscribes, before.subscribes + 1);
		assert.equal(after.records.beta.syncNeeded, false);
		assert.deepEqual(after.subscriptions[origin + "/"], before.subscriptions[origin + "/"]);
		console.log("PASS: expired Beta subscription is repaired by a signed-in page only; root is untouched.");
	} else if (mode === "remove-beta") {
		const before = await state();
		await evaluate(`document.querySelector('a[href="/settings/backends"]').click()`);
		await settled();
		await evaluate(`document.querySelector('a[href="/settings/backends/beta"]').click()`);
		await settled();
		await button("Remove");
		await button("Remove Beta");
		const after = await state();
		assert.deepEqual(after.scopes, ["/"]);
		assert.equal(after.records.beta, undefined);
		assert.deepEqual(after.subscriptions[origin + "/"], before.subscriptions[origin + "/"]);
		console.log("PASS: backend removal prunes only its own worker/subscription.");
	} else if (mode === "snap") {
		const [name, width = "1440", theme = "dark"] = args;
		await call("Emulation.setDeviceMetricsOverride", {
			width: Number(width),
			height: Number(width) < 600 ? 1000 : 1100,
			deviceScaleFactor: 1,
			mobile: Number(width) < 600,
		});
		await page.run(showBackendPushSettings, theme);
		const screenshot = await call<{ data: string }>("Page.captureScreenshot", { format: "png" });
		await mkdir(".preview", { recursive: true });
		await Bun.write(".preview/" + name + ".png", Buffer.from(screenshot.data, "base64"));
		console.log("Saved " + name);
	} else if (mode === "record") {
		await mkdir(".preview/push-recording", { recursive: true });
		await call("Emulation.setDeviceMetricsOverride", {
			width: 1440,
			height: 1000,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await page.run(() => {
			document.documentElement.classList.add("dark");
			document.querySelector("#notifications-enabled")!.scrollIntoView({ block: "center" });
		});
		let frame = 0;
		const writes: Promise<unknown>[] = [];
		const timestamps: number[] = [];
		page.onFrame = (params) => {
			const index = frame++;
			timestamps.push(params.metadata.timestamp);
			writes.push(
				Bun.write(
					".preview/push-recording/" + String(index).padStart(5, "0") + ".jpg",
					Buffer.from(params.data, "base64"),
				),
			);
			void call("Page.screencastFrameAck", { sessionId: params.sessionId });
		};
		await call("Page.startScreencast", { format: "jpeg", quality: 85, everyNthFrame: 1 });
		await settled();
		await evaluate(`document.querySelector('#notifications-enabled').click()`);
		await settled();
		await page.run(showBackendPushSettings, "dark", true);
		await evaluate(`new Promise(resolve => setTimeout(resolve, 3500))`);
		await call("Page.stopScreencast");
		await Promise.all(writes);
		let concat = "";
		for (let i = 0; i < timestamps.length; i++) {
			const duration = i + 1 < timestamps.length ? Math.max(0.02, timestamps[i + 1]! - timestamps[i]!) : 2;
			concat += `file '${String(i).padStart(5, "0")}.jpg'\nduration ${duration}\n`;
		}
		await Bun.write(".preview/push-recording/frames.txt", concat);
		console.log(`Saved ${frame} real Chromium screencast frames.`);
	} else if (mode === "state") console.log(JSON.stringify(await state(), null, 2));
	else throw new Error("Unknown browser test phase: " + mode);
} finally {
	page.close();
}
