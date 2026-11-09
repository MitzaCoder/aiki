/** Real 2-second saved video, final phone layout. Coordinates derive from a fresh screenshot,
 * NOT stale hierarchy: Media3 prevents UIAutomator idle while its view is mounted. */
import {device} from "./native-ui.ts";
const out = process.env.HARNESS_ANDROID_DEVICE_CAPTURES;
if (!out?.endsWith("/ROUND2/NATIVE")) throw new Error("Use isolated round-two capture directory");
const logs = () => device("adb", "logcat", "-d", "-s", "HarnessMedia:D", "*:S");
const latestReady = (value: string) => {
    const m = [...value.matchAll(/ready source=(\d+) durationMs=(\d+) positionMs=(\d+)/g)].at(-1);
    if (!m) throw new Error("No native player READY callback");
    return {source: Number(m[1]), durationMs: Number(m[2]), positionMs: Number(m[3])};
};
async function renewed(previous: number) {
    const until = Date.now() + 33_000;
    while (Date.now() < until) {
        const value = latestReady(await logs());
        if (value.source > previous) return value;
        await Bun.sleep(100);
    }
    throw new Error("Actual signed-source renewal was not decoded READY in time");
}
const seek = async (x: number) => device("adb", "shell", "input", "tap", String(x), "1678");
// Player controls were freshly located in functional-real-video-initial.png (1080×2400).
if (process.argv.includes("--reset-ended")) {
    await device("adb", "shell", "input", "tap", "540", "1510");
    await Bun.sleep(200);
    await device("adb", "shell", "input", "tap", "540", "1510");
}
await seek(650);
await Bun.sleep(300);
const pausedBefore = latestReady(await logs());
if (pausedBefore.positionMs < 1100 || pausedBefore.positionMs > 1400) throw new Error("Seek did not reach expected position");
const pausedAfter = await renewed(pausedBefore.source);
const pausedRenewedAt = Date.now();
if (Math.abs(pausedAfter.positionMs - pausedBefore.positionMs) > 100) throw new Error("Paused position changed on renewal");
await device("capture", "functional-real-video-paused-after-renewal");
// Start just before the next 25-second renewal: this short source otherwise ends before renewal.
// device capture writes the PNG immediately, then can spend ~12s attempting an idle dump.
await Bun.sleep(Math.max(0, 23_300 - (Date.now() - pausedRenewedAt)));
await seek(63);
await device("adb", "shell", "input", "tap", "540", "1510");
const playingAfter = await renewed(pausedAfter.source);
await device("capture", "functional-real-video-playing-after-renewal");
if (playingAfter.positionMs <= 0 || playingAfter.positionMs >= playingAfter.durationMs) throw new Error("Playing source did not renew mid-clip");
const sanitizedCallbacks = await logs();
await Bun.write(`${out}/real-media-callbacks.log`, sanitizedCallbacks);
await Bun.write(`${out}/real-media-renewal.json`, JSON.stringify({
    server: "actual imported checkout on loopback4790", model: "faux (tools/server/media real)",
    initialDecodedFrame: /frame source=1 durationMs=2000/.test(sanitizedCallbacks),
    pausedBefore, pausedAfter, playingAfter,
    pausedIntentEvidence: "Play triangle remains visible in functional-real-video-paused-after-renewal.png",
    playingIntentEvidence: "Inspect Pause control in functional-real-video-playing-after-renewal.png; callback confirms nonzero restored mid-clip position",
    note: "Actual timed signed URL renewal; expiry rejection independently covered by opt-in real JVM contract. No stale XML used."
}, null, 2)+"\n");
console.log(JSON.stringify({pausedBefore, pausedAfter, playingAfter}));
// Leave Media3 before asking UIAutomator for a fresh idle hierarchy.
await device("adb", "shell", "input", "tap", "755", "221");
