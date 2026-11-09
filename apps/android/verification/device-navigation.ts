/** Native UI navigation smoke, not backend semantics coverage. Bun only; talks to the isolated device.sh adb. */
import { fileURLToPath } from "bun";

const script = fileURLToPath(new URL("./device.sh", import.meta.url));
const ownerHome = process.env.HOME!;
const root = process.env.HARNESS_ANDROID_DEVICE_ROOT ?? `${ownerHome}/scratch/android-cache/device`;
if (!root.startsWith(`${ownerHome}/scratch/`)) throw new Error("Artifacts must stay under ~/scratch");
const captures = process.env.HARNESS_ANDROID_DEVICE_CAPTURES ?? `${ownerHome}/scratch/android-screens/FINAL`;
const evidence: string[] = [];
async function device(...args: string[]): Promise<string> {
    const process = Bun.spawn([script, ...args], { stdout: "pipe", stderr: "pipe" });
    const timeout = setTimeout(() => process.kill(), args[0] === "start" ? 250_000 : 30_000);
    const [out, err, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
    clearTimeout(timeout);
    if (code !== 0) throw new Error(`device.sh ${args[0]} failed (${code}): ${err}\n${out}`);
    return out;
}
const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
type Node = { text: string; description: string; bounds: number[]; enabled: boolean };
function nodes(xml: string): Node[] {
    return [...xml.matchAll(/<node\b[^>]*>/g)].map(([tag]) => {
        const attributes = Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, decode(value!)]));
        return { text: attributes.text ?? "", description: attributes["content-desc"] ?? "", bounds: [...(attributes.bounds ?? "").matchAll(/\d+/g)].map(([n]) => Number(n)), enabled: attributes.enabled === "true" };
    });
}
async function tree(): Promise<Node[]> {
    await device("adb", "shell", "uiautomator", "dump", "/sdcard/harness-qa.xml");
    return nodes(await device("adb", "exec-out", "cat", "/sdcard/harness-qa.xml"));
}
async function find(label: RegExp, scroll = false): Promise<Node> {
    for (let attempt = 0; attempt < (scroll ? 10 : 5); attempt++) {
        const match = (await tree()).find(node => node.enabled && (label.test(node.text) || label.test(node.description)) && node.bounds.length === 4 && node.bounds[3]! > node.bounds[1]!);
        if (match) return match;
        if (scroll) await device("adb", "shell", "input", "swipe", "500", "1800", "500", "600", "250");
        await Bun.sleep(300);
    }
    throw new Error(`UI element not found: ${label}`);
}
async function tap(label: RegExp, scroll = false) {
    const node = await find(label, scroll);
    const [x1,y1,x2,y2] = node.bounds;
    await device("adb", "shell", "input", "tap", String(Math.round((x1! + x2!) / 2)), String(Math.round((y1! + y2!) / 2)));
    await Bun.sleep(250);
}
async function type(label: RegExp, value: string) {
    await tap(label, true);
    await device("adb", "shell", "input", "text", value.replaceAll(" ", "%s"));
    await device("adb", "shell", "input", "keyevent", "KEYCODE_BACK");
}
async function capture(label: string) { await device("capture", label); evidence.push(`${captures}/${label}.png`); }
async function assertFixture() {
    await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket("ws://127.0.0.1:4791/ws");
        const timeout = setTimeout(() => { ws.close(); reject(new Error("Start the labeled contract fixture on port 4791 first")); }, 5000);
        ws.onopen = () => ws.send(JSON.stringify({ type: "hello", id: "native-qa", protocolVersion: 1 }));
        ws.onerror = () => { clearTimeout(timeout); reject(new Error("Fixture is not running on 4791")); };
        ws.onmessage = ({data}) => {
            clearTimeout(timeout);
            const response = JSON.parse(String(data));
            ws.close();
            if (response.server?.name !== "ANDROID CONTRACT FIXTURE") reject(new Error("Refusing to mutate UI against an unlabeled backend"));
            else resolve();
        };
    });
}

await device("start");
await device("phone");
await device("adb", "shell", "am", "force-stop", "com.mihaisaru.harness");
await device("launch");
// No backend is added: this deliberately nonfunctional HTTPS address is previewed then cancelled.
const payload = "v1." + Buffer.from("CONNECT PREVIEW ONLY\thttps://preview.invalid").toString("base64url");
await device("open", `https://harness.example.test/connect#${payload}`);
await find(/^Add these backends\?$/);
await find(/^CONNECT PREVIEW ONLY/);
await capture("https-connect-preview-phone");
await device("landscape");
await find(/^Add these backends\?$/);
await device("phone");
await find(/^Add these backends\?$/);
await tap(/^Cancel$/);
await device("landscape");
await device("phone");
if ((await tree()).some(node => node.text === "Add these backends?")) throw new Error("Consumed import reopened on recreation");
await tap(/^Open projects$/);
await tap(/^Notifications$/);
await capture("notifications-navigation");
await tap(/^Back$/);

if (process.argv.includes("--fixture")) {
    await assertFixture();
    // Works with both the foundation form and the settings-worker replacement.
    await type(/^(Backend name|Name \(optional; filled from address\))$/, "Contract QA");
    await type(/^(https:\/\/backend\.example|URL, host, or published name)$/, "http://127.0.0.1:4791");
    await tap(/^Add backend$/, true);
    await tap(/^Open projects$/);
    await tap(/^ANDROID CONTRACT FIXTURE$/);
    await find(/^Panels$/);
    await type(/^Message the coordinator…$/, "Navigation QA draft");
    await tap(/^Project settings$/);
    await capture("project-settings-navigation");
    await tap(/^Back$/);
    await find(/^Navigation QA draft$/);
    await tap(/^Panels$/);
    const phone = await find(/^Conversation panels$/);
    if (phone.bounds[0] !== 0) throw new Error("Phone panels must cover the viewport, not squeeze chat");
    await capture("panels-phone-fullscreen");
    await device("tablet");
    await Bun.sleep(1000);
    const tablet = await find(/^Conversation panels$/);
    if (tablet.bounds[0]! <= 0) throw new Error("Tablet panels must be beside chat, not fullscreen");
    await capture("panels-tablet-beside-chat");
    await tap(/^Close panels$/);
    await device("phone");
    await find(/^Navigation QA draft$/);
}
await Bun.write(`${root}/navigation-smoke.json`, JSON.stringify({ at: new Date().toISOString(), fixture: process.argv.includes("--fixture"), evidence, scope: "Native navigation only; fixture != real backend; no production data" }, null, 2));
console.log(`Navigation smoke passed; evidence: ${root}/navigation-smoke.json`);
