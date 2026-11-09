import { test, expect } from "bun:test";

async function run(mode: "--smoke" | "--contracts") {
	const child = Bun.spawn(
		[process.execPath, "run", `${import.meta.dir}/launch-real.ts`, mode],
		{
			env: { ...process.env, PORT: "0" },
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const timeout = setTimeout(() => child.kill("SIGTERM"), 50_000);
	try {
		const [output, errors, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		if (code !== 0) throw new Error(`${output}\n${errors}`);
		expect(output).toContain(mode === "--smoke" ? "REAL API SMOKE PASS" : "REAL THREAD/ARTIFACT CONTRACT PASS");
		expect(output).toContain("model faux/faux-1");
	} finally {
		clearTimeout(timeout);
		child.kill();
	}
}

test("isolated actual checkout startServer API smoke (faux model only)", () => run("--smoke"), 55_000);
test("actual thread/board/worker/artifact tools, scoped protocol, final-card data and signed HTTP", () => run("--contracts"), 55_000);
