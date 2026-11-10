import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { disableAccount, enableAccount, disablePhone, setRelayControl } from "../src/operator";
import { resumeAccountCleanup } from "../src/cleanup";
import { reconcileRelay } from "../src/reconciliation";
import type { Dependencies } from "../src/ports";
import type { ControlDocument } from "../src/documents";

if (
	process.env.HOME !== resolve(import.meta.dir, "../.emulator/home") ||
	process.env.GCLOUD_PROJECT !== "demo-aiki-relay" ||
	!/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "") ||
	!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? "")
) {
	throw new Error("Scrubbed demo emulator launcher required");
}
const app = initializeApp({ projectId: "demo-aiki-relay" });
const firestore = getFirestore(app);
const deps: Dependencies = {
	firestore,
	auth: getAuth(app),
	projectId: "demo-aiki-relay",
	now: Date.now,
	random: (bytes) => randomBytes(bytes).toString("base64url"),
	send: async () => {
		throw new Error("Admin never sends FCM");
	},
	verifyAppCheck: async () => false,
	monitor() {},
};
const [action, uid, argument] = process.argv.slice(2);
try {
	switch (action) {
		case "disable":
			await disableAccount(deps, uid);
			break;
		case "enable":
			await enableAccount(deps, uid);
			break;
		case "phone-disable":
			await disablePhone(deps, uid, argument);
			break;
		case "resume":
			await resumeAccountCleanup(deps, uid);
			break;
		case "reconcile":
			await reconcileRelay(deps);
			break;
		case "settings":
			await setRelayControl(deps, JSON.parse(uid) as ControlDocument);
			break;
		default:
			throw new Error("Expected disable, enable, phone-disable, resume, reconcile or settings");
	}
	console.info("Operator action finished");
} catch {
	console.error("Operator action failed");
	process.exitCode = 1;
} finally {
	await firestore.terminate();
}
