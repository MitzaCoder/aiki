/** Bounded, label-driven UIAutomator helpers. Bun only; no production endpoints. */
import { fileURLToPath } from "bun";
const script = fileURLToPath(new URL("./device.sh", import.meta.url));
export const artifacts = process.env.HARNESS_ANDROID_DEVICE_CAPTURES ?? `${process.env.HOME}/scratch/android-screens/FINAL`;
export async function device(...args: string[]) {
    const child = Bun.spawn([script, ...args], { stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill(), args[0] === "start" ? 250_000 : 30_000);
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    clearTimeout(timer);
    if (code) throw new Error(`device ${args[0]} (${code}): ${err}\n${out}`);
    return out;
}
export const decodeUiAttribute = (s: string) => s.replace(/&#(?:x([0-9a-fA-F]+)|([0-9]+));/g, (_, hex: string | undefined, decimal: string | undefined) => String.fromCodePoint(parseInt(hex ?? decimal!, hex ? 16 : 10))).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
export type Node = { text: string; desc: string; bounds: number[]; enabled: boolean; selected: boolean; resource: string; className: string };
export async function tree(): Promise<Node[]> {
    let xml="";
    for(let attempt=0;attempt<3;attempt++) {
        await device("adb","shell","rm","-f","/sdcard/harness-final.xml");
        await device("adb", "shell", "uiautomator", "dump", "/sdcard/harness-final.xml");
        // Success notices may use stderr; an exec-out failure may still exit zero.
        xml=await device("adb", "exec-out", "cat", "/sdcard/harness-final.xml");
        if(xml.includes("<hierarchy")) break;
        await Bun.sleep(500);
    }
    if(!xml.includes("<hierarchy")) throw new Error("No fresh UI hierarchy; never reuse stale XML.");
    return [...xml.matchAll(/<node\b[^>]*>/g)].map(([tag]) => {
        const a = Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([,k,v]) => [k!, decodeUiAttribute(v!)]));
        return { text: a.text ?? "", desc: a["content-desc"] ?? "", bounds: [...(a.bounds ?? "").matchAll(/\d+/g)].map(([n]) => Number(n)), enabled: a.enabled === "true", selected: a.selected === "true", resource: a["resource-id"] ?? "", className: a.class ?? "" };
    });
}
export async function swipe(direction: "down" | "up" | "left" = "down") {
    const size = [...(await device("adb", "shell", "wm", "size")).matchAll(/(\d+)x(\d+)/g)].at(-1)!;
    const w = Number(size[1]), h = Number(size[2]);
    if(direction === "left") await device("adb", "shell", "input", "swipe", String(w*.85), String(h*.145), String(w*.2), String(h*.145), "300");
    else await device("adb", "shell", "input", "swipe", String(w*.55), String(h*(direction === "down" ? .78 : .28)), String(w*.55), String(h*(direction === "down" ? .3 : .82)), "250");
}
export async function find(label: RegExp, scroll: false | "up" | "down" = false, attempts = scroll ? 16 : 5): Promise<Node> {
    for(let i=0;i<attempts;i++) {
        const result = (await tree()).find(n => n.enabled && (label.test(n.text) || label.test(n.desc) || label.test(n.resource)) && n.bounds.length === 4 && n.bounds[2]!>n.bounds[0]! && n.bounds[3]!>n.bounds[1]!);
        if(result) return result;
        if(scroll) await swipe(scroll);
        await Bun.sleep(200);
    }
    await device("capture", "failure-last");
    throw new Error(`Native UI element missing: ${label}`);
}
export async function tapNode(n: Node) {
    await device("adb", "shell", "input", "tap", String(Math.round((n.bounds[0]!+n.bounds[2]!)/2)), String(Math.round((n.bounds[1]!+n.bounds[3]!)/2)));
    await Bun.sleep(250);
}
export async function tap(label: RegExp, scroll: false | "up" | "down" = false) { await tapNode(await find(label, scroll)); }
export async function type(label: RegExp, value: string, scroll: false | "up" | "down" = "down", clear = false) {
    await typeNode(await find(label, scroll),value,clear);
}
export async function typeNode(node:Node,value:string,clear=false) {
    await tapNode(node);
    if(clear) { await device("adb", "shell", "input", "keycombination", "113", "29"); await device("adb", "shell", "input", "keyevent", "KEYCODE_DEL"); }
    if (value) await device("adb", "shell", "input", "text", value.replaceAll(" ", "%s"));
    const ime = await device("adb","shell","dumpsys","input_method");
    if(/mInputShown=true|isInputViewShown=true/.test(ime)) await device("adb", "shell", "input", "keyevent", "KEYCODE_BACK");
}
export async function capture(label: string, idle=true) { await Bun.sleep(700); if(idle) await tree(); await device("capture", label); console.log(`Evidence: ${artifacts}/${label}.png`); }
export async function backends() { await tap(/^Open projects$/); await tap(/^Backends & settings$/); }
export async function project(name: RegExp) { await tap(/^Open projects$/); await tap(name, "down"); }
