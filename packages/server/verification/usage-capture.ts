/** Headless proof against usage-fixture.ts and the web dev server. Bun only. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
const out = process.env.USAGE_PROOF_DIR ?? "deploy/local/usage-proof";
await mkdir(out, { recursive: true });
const targets = (await (
	await fetch("http://localhost:9388/json/list", { signal: AbortSignal.timeout(5000) })
).json()) as { webSocketDebuggerUrl: string }[];
const socket = new WebSocket(targets[0]!.webSocketDebuggerUrl);
await new Promise<void>((resolve, reject) => {
	socket.onopen = () => resolve();
	socket.onerror = reject;
	setTimeout(() => reject(Error("socket timeout")), 5000);
});
let sequence = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
let frames = 0;
let recording = false;
const runtimeErrors: string[] = [];
socket.onmessage = async (event) => {
	const message = JSON.parse(String(event.data));
	if (message.method === "Runtime.exceptionThrown") runtimeErrors.push(JSON.stringify(message.params));
	if (message.id) {
		const p = pending.get(message.id);
		pending.delete(message.id);
		if (message.error) p?.reject(Error(JSON.stringify(message.error)));
		else p?.resolve(message.result);
	}
	if (message.method === "Page.screencastFrame") {
		if (recording)
			await writeFile(
				`${out}/frame-${String(frames++).padStart(4, "0")}.jpg`,
				Buffer.from(message.params.data, "base64"),
			);
		void call("Page.screencastFrameAck", { sessionId: message.params.sessionId });
	}
};
function call(method: string, params: Record<string, unknown> = {}): Promise<any> {
	const id = ++sequence;
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			pending.delete(id);
			reject(Error(`${method} timeout`));
		}, 10000);
		pending.set(id, {
			resolve: (v) => {
				clearTimeout(timer);
				resolve(v);
			},
			reject: (e) => {
				clearTimeout(timer);
				reject(e);
			},
		});
		socket.send(JSON.stringify({ id, method, params }));
	});
}
async function evaluate(expression: string) {
	const answer = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
	if (answer.exceptionDetails) throw Error(JSON.stringify(answer.exceptionDetails));
	return answer.result.value;
}
const pause = () => new Promise((r) => setTimeout(r, 1100));
await call("Page.enable");
await call("Runtime.enable");
const fixture = JSON.parse(await readFile("/tmp/aiki-t78-fixture.json", "utf8"));
await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
await call("Page.navigate", { url: "http://localhost:5288" });
await pause();
await evaluate(
	`localStorage.setItem('aiki.backends.v1',JSON.stringify([{id:'synthetic',name:'Synthetic demo',url:${JSON.stringify(fixture.url)}}]));location.reload()`,
);
await pause();
await pause();
await evaluate(
	`Array.from(document.querySelectorAll('button,a')).find(e=>e.textContent?.trim().startsWith('Usage'))?.click()`,
);
await pause();
const after = process.argv.includes("--after");
const checks: Record<string, unknown> = {};
if (after) {
	await evaluate(`document.querySelector('[role=tab]')?.focus()`);
	await call("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight" });
	checks.keyboard = await evaluate(
		`document.activeElement?.textContent?.trim()==='By role' && document.activeElement?.getAttribute('aria-selected')==='true'`,
	);
	await call("Input.dispatchKeyEvent", { type: "keyDown", key: "End", code: "End" });
	checks.endKey = await evaluate(`document.activeElement?.textContent?.trim()==='Waste'`);
	await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Home", code: "Home" });
	checks.homeKey = await evaluate(`document.activeElement?.textContent?.trim()==='Overview'`);
	const before = await evaluate(`document.querySelector('#usage-panel')?.textContent`);
	await evaluate(
		`Array.from(document.querySelectorAll('[aria-label="Recorded period"] button')).find(e=>e.textContent==='Today')?.click()`,
	);
	await pause();
	checks.period = (await evaluate(`document.querySelector('#usage-panel')?.textContent`)) !== before;
	await evaluate(
		`Array.from(document.querySelectorAll('[aria-label="Recorded period"] button')).find(e=>e.textContent==='30 days')?.click()`,
	);
	await pause();
	await evaluate(
		`Array.from(document.querySelectorAll('button')).find(e=>e.textContent?.trim()==='Use a reset…')?.click()`,
	);
	await pause();
	checks.confirmation = await evaluate(
		`document.querySelector('[role=alert]')?.textContent?.includes('cannot be undone')`,
	);
	const confirm = await call("Page.captureScreenshot", { format: "png" });
	await writeFile(`${out}/after-desktop-dark-reset-confirmation.png`, Buffer.from(confirm.data, "base64"));
	await evaluate(`Array.from(document.querySelectorAll('button')).find(e=>e.textContent?.trim()==='Cancel')?.click()`);
	await pause();
	checks.cancel = await evaluate(`!document.querySelector('[role=alert]')`);
	if (Object.values(checks).some((v) => v !== true)) throw Error(JSON.stringify(checks));
}

for (const [form, theme, width, height] of [
	["desktop", "light", 1440, 1050],
	["desktop", "dark", 1440, 1050],
	["phone", "dark", 412, 915],
] as const) {
	await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: form === "phone" });
	await call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
	await pause();
	if (after)
		checks[`${form}-${theme}-overflow`] = await evaluate(
			`document.documentElement.scrollWidth<=innerWidth && document.querySelector('[role=tabpanel]').scrollWidth<=document.querySelector('[role=tabpanel]').clientWidth`,
		);
	const tabs = after ? ["Overview", "By role", "By model", "Projects & tasks", "Waste"] : ["Overview"];
	for (const tab of tabs) {
		if (after) {
			await evaluate(
				`Array.from(document.querySelectorAll('[role=tab]')).find(e=>e.textContent?.trim()===${JSON.stringify(tab)})?.click()`,
			);
			await pause();
		}
		await evaluate("document.activeElement?.blur()");
		const png = await call("Page.captureScreenshot", { format: "png" });
		await writeFile(
			`${out}/${after ? "after" : "before"}-${form}-${theme}-${tab.toLowerCase().replaceAll(/[^a-z]+/g, "-")}.png`,
			Buffer.from(png.data, "base64"),
		);
	}
}
if (after) {
	await call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
	recording = true;
	await call("Page.startScreencast", { format: "jpeg", quality: 75, everyNthFrame: 1 });
	for (const tab of ["Overview", "By role", "By model", "Projects & tasks", "Waste"]) {
		await evaluate(
			`Array.from(document.querySelectorAll('[role=tab]')).find(e=>e.textContent?.trim()===${JSON.stringify(tab)})?.click()`,
		);
		await pause();
	}
	await evaluate(
		`Array.from(document.querySelectorAll('[role=tab]')).find(e=>e.textContent?.trim()==='Overview')?.click()`,
	);
	await pause();
	await evaluate(
		`Array.from(document.querySelectorAll('button')).find(e=>e.textContent?.trim()==='Use a reset…')?.click()`,
	);
	await pause();
	await evaluate(
		`Array.from(document.querySelectorAll('button')).find(e=>e.textContent?.trim()==='Confirm · use 1 reset')?.click()`,
	);
	await pause();
	checks.syntheticReset = await evaluate(
		`document.querySelector('[aria-label="Saved subscription resets"]')?.textContent?.includes('Reset applied.') && document.querySelector('[aria-label="Saved subscription resets"]')?.textContent?.includes('1 available')`,
	);
	const reset = await call("Page.captureScreenshot", { format: "png" });
	await writeFile(`${out}/after-desktop-dark-reset-result.png`, Buffer.from(reset.data, "base64"));
	await call("Page.stopScreencast");
	recording = false;
	checks.noRuntimeErrors = runtimeErrors.length === 0;
	if (Object.values(checks).some((v) => v !== true)) throw Error(JSON.stringify({ checks, runtimeErrors }));
	const tabs = await evaluate(
		`Array.from(document.querySelectorAll('[role=tab]')).map(e=>({label:e.textContent,selected:e.getAttribute('aria-selected')}))`,
	);
	console.log(JSON.stringify({ tabs, frames, checks }));
	await writeFile(`${out}/browser-checks.json`, JSON.stringify({ tabs, frames, checks }, null, 2));
}
console.log(await evaluate("document.body.innerText.slice(-3500)"));
socket.close();
process.exit(0);
