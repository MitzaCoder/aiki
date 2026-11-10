import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { resolve } from "node:path";
import { createStore } from "../src/documents";
import { DEFAULT_DATABASE_ID, requireDatabaseId } from "../src/database";
import { DEMO_PROJECT, emulatorPorts, relayRoot } from "./emulator-launch";

const ports = emulatorPorts();
if (
	process.env.GCLOUD_PROJECT !== DEMO_PROJECT ||
	process.env.HOME !== resolve(relayRoot, `.emulator/stack-${ports.functions}/home`) ||
	process.env.FIREBASE_AUTH_EMULATOR_HOST !== `127.0.0.1:${ports.auth}` ||
	process.env.FIRESTORE_EMULATOR_HOST !== `127.0.0.1:${ports.firestore}`
) {
	throw new Error("Scrubbed loopback demo launcher required");
}
const app = initializeApp({ projectId: DEMO_PROJECT });
const db = getFirestore(app, requireDatabaseId(process.env.RELAY_DATABASE_ID ?? DEFAULT_DATABASE_ID));
try {
	// A demo explicitly opts in; a production/fresh database must never inherit this setting.
	await createStore(db).control.doc("settings").create({ enabled: true, enrollmentEnabled: true });
} finally {
	await db.terminate();
	await deleteApp(app);
}
// Bun can retain gRPC channel handles after SDK termination. This one-shot child must finish before readiness.
process.exit(0);
