export interface RuntimeEnvironment {
	FUNCTIONS_EMULATOR?: string;
	FIREBASE_AUTH_EMULATOR_HOST?: string;
	FIRESTORE_EMULATOR_HOST?: string;
	FIREBASE_APPCHECK_EMULATOR_HOST?: string;
	RELAY_TEST_FCM_PORT?: string;
	RELAY_APP_CHECK_BYPASS?: string;
	GCLOUD_PROJECT?: string;
}
/** Refuse every test seam outside a loopback demo emulator; no App Check bypass exists. */
export function runtimeMode(env: RuntimeEnvironment): {
	emulator: boolean;
	projectId: string;
	fakeFcmPort?: number;
} {
	const emulator = env.FUNCTIONS_EMULATOR === "true";
	const seams = [
		env.FIREBASE_AUTH_EMULATOR_HOST,
		env.FIRESTORE_EMULATOR_HOST,
		env.FIREBASE_APPCHECK_EMULATOR_HOST,
		env.RELAY_TEST_FCM_PORT,
		env.RELAY_APP_CHECK_BYPASS,
	];
	if (!emulator && seams.some((value) => value !== undefined)) throw new Error("Emulator configuration refused");
	const projectId = env.GCLOUD_PROJECT ?? "";
	if (!projectId) throw new Error("Project required");
	if (emulator) {
		if (
			!/^demo-[a-z0-9-]+$/.test(projectId) ||
			!/^127\.0\.0\.1:\d+$/.test(env.FIREBASE_AUTH_EMULATOR_HOST ?? "") ||
			!/^127\.0\.0\.1:\d+$/.test(env.FIRESTORE_EMULATOR_HOST ?? "")
		)
			throw new Error("Loopback demo emulators required");
		if (
			env.RELAY_TEST_FCM_PORT !== undefined &&
			(!/^\d+$/.test(env.RELAY_TEST_FCM_PORT) || +env.RELAY_TEST_FCM_PORT < 1024 || +env.RELAY_TEST_FCM_PORT > 65535)
		)
			throw new Error("Local fake FCM required");
	}
	// There is deliberately no App Check bypass, even in the emulator.
	if (env.RELAY_APP_CHECK_BYPASS !== undefined || env.FIREBASE_APPCHECK_EMULATOR_HOST !== undefined)
		throw new Error("App Check bypass refused");
	return { emulator, projectId, ...(emulator ? { fakeFcmPort: Number(env.RELAY_TEST_FCM_PORT ?? 19377) } : {}) };
}
