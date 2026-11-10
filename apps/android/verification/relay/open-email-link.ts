import { resolve } from "node:path";

/** Open a synthetic Auth emulator email link without logging its one-time code or putting email in the URL. */
if (process.env.HARNESS_ANDROID_DEVICE !== "x") throw new Error("This proof driver requires owned emulator track x");
const email = process.argv[2] ?? "relay@example.test";
if (!email.endsWith("@example.test")) throw new Error("Synthetic email address required");
const response = await fetch("http://127.0.0.1:19571/emulator/v1/projects/demo-aiki-relay/oobCodes", {
	signal: AbortSignal.timeout(3000),
});
if (!response.ok) throw new Error("Auth emulator codes unavailable");
const codes = await response.json() as { oobCodes: { email: string; oobCode: string; requestType: string }[] };
const code = codes.oobCodes.filter((entry) => entry.email === email && entry.requestType === "EMAIL_SIGNIN").at(-1);
if (!code) throw new Error("No synthetic sign-in link found");
const link = new URL("https://relay.example.test/__/auth/links");
link.search = new URLSearchParams({ mode: "signIn", apiKey: "demo-api-key-not-a-real-key", oobCode: code.oobCode }).toString();
const child = Bun.spawn([resolve(import.meta.dir, "../device.sh"), "open", link.href], {
	env: { ...process.env, HARNESS_ANDROID_DEVICE: "x" },
	stdout: "ignore",
	stderr: "ignore",
	timeout: 10000,
});
if (await child.exited !== 0) throw new Error("Owned emulator did not accept the email App Link");
console.log("Synthetic email link opened on owned emulator");
