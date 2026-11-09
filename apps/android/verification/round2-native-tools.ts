/** Actual native tool initiation on a fresh isolated --fresh real runner. No final visual captures.
 * Run after registering 4790 through the native settings form. Never runs on arbitrary backends.
 * Faux chooses calls; the real server executes every tool. RPCs here only READ/verify state.
 */
import assert from "node:assert/strict";
import { connect } from "./wire.ts";
import { contentText } from "./real-scenarios.ts";
import { device, find, project, tap, type } from "./native-ui.ts";

const origin = "http://127.0.0.1:4790";
const client = await connect(origin);
try {
    const hello = await client.request("hello", { protocolVersion: 1 });
    assert.notEqual(hello.server.name, "ANDROID CONTRACT FIXTURE");
    const models = await client.request("models.list");
    assert(models.models.some((m: any) => m.provider === "faux" && m.configured));
    const projects = await client.request("projects.list");
    const target = projects.projects.find((p: any) => p.name === "Android real checkout (faux model)");
    assert(target && /^\/tmp\/harness-verification\/scratch\/android-verification-real-smoke-[^/]+\/project$/.test(target.path), "Use launch-real.ts --fresh scratch project only");
    const projectId: string = target.id;
    const initial = await client.request("threads.list", { projectId });
    assert(!initial.threads.some((t: any) => !t.main), "Refusing to repeat revision-dependent controls: use a fresh runner");
    assert.equal((await client.request("board.get", { projectId })).board.tasks.length, 0);
    const results: Record<string, unknown>[] = [];
    async function until<T>(read: () => Promise<T>, matches: (value: T) => boolean, label: string): Promise<T> {
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
            const value = await read();
            if (matches(value)) return value;
            await Bun.sleep(100);
        }
        throw new Error(`Real state did not settle: ${label}`);
    }
    async function page(threadId?: string) { return client.request("conversation.page", { projectId, ...(threadId ? { threadId } : {}), limit: 500, order: "ascending" }); }
    async function main() { await project(/^Android real checkout \(faux model\)$/); }
    async function background() {
        await main();
        await tap(/^Open project panels$/);
        await tap(/^Background(?:,.*)?$/);
        await tap(/^Open Contract proof$/, "down");
    }
    async function send(text: string, threadId?: string) {
        await find(/^Message the coordinator…$/);
        await type(/^Message the coordinator…$/, text, false, true);
        await tap(/^Send$/);
        await until(() => page(threadId), (p: any) => p.entries.some((e: any) => e.kind === "pi.user" && (e.model ?? []).some((m: any) => contentText(m.content) === text)), `native input ${text}`);
        await until(() => client.request("threads.list", { projectId }), (r: any) => {
            const t = r.threads.find((t: any) => t.id === (threadId ?? "main"));
            return t && t.status !== "running";
        }, `settled ${text}`);
        results.push({ input: text, threadId: threadId ?? "main", initiated: "native composer" });
    }
    await device("phone");
    await main();
    await send("R2 start");
    await until(() => client.request("artifacts.list", { projectId, threadId: "contract-proof" }), (r: any) => r.artifacts.length === 4, "four actual background artifacts");
    await background();
    const mainBefore = await page();
    await send("R2 scoped", "contract-proof");
    const mainAfter = await page();
    assert.deepEqual(mainAfter.entries, mainBefore.entries, "Background composer must not mutate main");
    await send("R2 worker", "contract-proof");
    await until(() => client.request("artifacts.list", { projectId, threadId: "contract-proof", workerId: "proof-worker" }), (r: any) => r.artifacts.length === 1, "actual background worker evidence");
    await send("R2 handoff", "contract-proof");
    await send("R2 finish", "contract-proof");
    await main();
    await send("R2 return");
    await background();
    await send("R2 late", "contract-proof");
    await send("R2 finish", "contract-proof");
    await main();
    for (const text of ["R2 main save", "R2 main worker", "R2 bad message", "R2 bad save", "R2 failure"]) await send(text);
    const artifacts = await until(() => client.request("artifacts.list", { projectId }), (r: any) => r.artifacts.length === 8, "eight actual artifacts across four owners");
    const entries = (await page()).entries;
    const all = JSON.stringify(entries);
    assert(all.includes("unknown_thread") && all.includes("missing-real-file.txt"), "Actual tool errors must be retained");
    await until(() => page(), (p: any) => JSON.stringify(p).includes("Deterministic verification model failure [not a server fixture]"), "bracket-bearing actual failure notice");
    const finishes = entries.flatMap((e: any) => {
        return e.kind === "pi.user" ? (e.model ?? []).filter((m: any) => contentText(m.content).startsWith("[thread contract-proof finished]")) : [];
    });
    assert.equal(finishes.length, 2, "Both historical finish notices persist");
    const cuts = finishes.map((m: any) => ({ timestamp: m.timestamp, artifacts: artifacts.artifacts.filter((a: any) => a.threadId === "contract-proof" && Date.parse(a.createdAt) <= m.timestamp).length }));
    assert.deepEqual(cuts.map((c: any) => c.artifacts).sort(), [5, 6]);
    const owners = artifacts.artifacts.map((a: any) => ({ kind: a.kind, threadId: a.threadId, workerId: a.workerId, taskId: a.taskId }));
    assert.equal(new Set(owners.map((a: any) => `${a.threadId}/${a.workerId ?? "coordinator"}`)).size, 4);
    await find(/Deterministic verification model failure \[not a server fixture\]/);
    const result = { pass: true, phase: "first-pass native functionality, NOT final visual signoff", scope: "actual native composer, real tools/server; deterministic faux model, no external provider", projectId, path: target.path, actions: results, backgroundMainUnchanged: true, finishCuts: cuts, owners, viewerDeferredToT25: true };
    const output = `${process.env.HOME}/scratch/android-screens/ROUND2/native-real-tools.json`;
    await Bun.write(output, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
} finally { client.close(); }
