import { resolve } from "node:path";

/** Deliver synthetic FCM captures to the owned emulator only. No device discovery or default adb selection. */
if (process.env.HARNESS_ANDROID_DEVICE !== "x") throw new Error("This proof driver requires owned emulator track x");
const device = resolve(import.meta.dir, "../device.sh");
const deadline = Date.now() + Number(process.env.RELAY_BRIDGE_SECONDS ?? "600") * 1000;
const endpoint = "http://127.0.0.1:19577/captured";
let delivered = 0;
while (Date.now() < deadline) {
	const response = await fetch(`${endpoint}?after=${delivered}`, { signal: AbortSignal.timeout(3000) });
	if (!response.ok) throw new Error("Fake FCM capture endpoint failed");
	const captured: unknown = await response.json();
	if (!captured || typeof captured !== "object" || !("messages" in captured) || !Array.isArray(captured.messages)) {
		throw new Error("Expected fake FCM capture page");
	}
	for (const entry of captured.messages as unknown[]) {
		if (!entry || typeof entry !== "object" || !("data" in entry) ||
			!entry.data || typeof entry.data !== "object" || !("aiki" in entry.data) || typeof entry.data.aiki !== "string") {
			throw new Error("Expected a synthetic aiki data message");
		}
		const body = "'" + entry.data.aiki.replaceAll("'", "'\\''") + "'";
		const child = Bun.spawn([device, "adb", "shell", "am", "broadcast", "-a",
			"io.github.mitzacoder.aiki.DEBUG_RELAY", "-p", "io.github.mitzacoder.aiki", "--es", "aiki", body], {
			env: { ...process.env, HARNESS_ANDROID_DEVICE: "x" },
			stdout: "ignore",
			stderr: "pipe",
			timeout: 10000,
		});
		if (await child.exited !== 0) throw new Error("Owned emulator delivery failed");
		delivered++;
		console.log(`Delivered synthetic message ${delivered}`);
	}
	await Bun.sleep(500);
}
