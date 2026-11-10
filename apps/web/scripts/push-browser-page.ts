import type { BackendPushSubscription } from "../src/lib/push-subscriptions.ts";
import type { PushFixture } from "./push-browser-stub.ts";
export type BrowserPushState = {
	text: string;
	scopes: string[];
	records: Record<string, BackendPushSubscription>;
	subscriptions: Record<string, { key: string; endpoint: string }>;
	subscribes: number;
	unsubscribes: number;
};

/** Read actual worker scopes together with the synthetic push-service counters and rendered settings. */
export async function browserPushState(): Promise<BrowserPushState> {
	return {
		text: document.body.innerText,
		scopes: (await navigator.serviceWorker.getRegistrations()).map(
			(registration) => new URL(registration.scope).pathname,
		),
		records: JSON.parse(localStorage.getItem("aiki.push-subscriptions.v1") ?? "{}"),
		subscriptions: JSON.parse(localStorage.getItem("demo-push-subscriptions") ?? "{}"),
		subscribes: Number(localStorage.getItem("demo-subscribes") ?? 0),
		unsubscribes: Number(localStorage.getItem("demo-unsubscribes") ?? 0),
	};
}

/** Seed only synthetic fixture sessions in the real origin-pinned credential store before loading the app. */
export async function seedPushBrowser(fixture: PushFixture, scenario: string, legacy: boolean, legacyPrefix: string) {
	const backends =
		scenario === "operator"
			? fixture.operatorBackends
			: scenario === "independent"
				? fixture.backends.slice(0, 2)
				: fixture.backends;
	localStorage.setItem("aiki.backends.v1", JSON.stringify(backends));
	if (legacyPrefix) localStorage.setItem(legacyPrefix + ".backends.v1", JSON.stringify(backends));
	localStorage.setItem("aiki.notification-device.v1", "synthetic-push-browser");
	const request = indexedDB.open("aiki-device-auth", 1);
	request.onupgradeneeded = () => request.result.createObjectStore("credentials");
	const db = await new Promise<IDBDatabase>((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
	const transaction = db.transaction("credentials", "readwrite");
	for (const record of fixture.credentials) {
		transaction.objectStore("credentials").put(record, JSON.stringify([record.backendId, record.origin]));
	}
	await new Promise<void>((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
	});
	db.close();
	if (legacy) {
		await navigator.serviceWorker.register("/service-worker.js", { scope: "/", type: "module" });
		localStorage.setItem(
			"demo-push-subscriptions",
			JSON.stringify({
				[location.origin + "/"]: { key: fixture.publicKeys[0], endpoint: fixture.pushOrigin + "/legacy-untouched" },
			}),
		);
	}
}

/** Click only the requested enabled settings action, never a similarly named unrelated control. */
export function clickPushButton(label: string, index: number): void {
	const button = [...document.querySelectorAll("button")].filter((button) => button.textContent?.trim() === label)[
		index
	];
	if (!button || button.disabled) throw new Error("Button unavailable: " + label);
	button.click();
}

/** Seed a prior Beta key without touching a browser subscription; loading must require explicit repair. */
export function seedPreviousBetaKey(key: string): void {
	const records = JSON.parse(localStorage.getItem("aiki.push-subscriptions.v1")!) as BrowserPushState["records"];
	records.beta!.publicKey = key;
	localStorage.setItem("aiki.push-subscriptions.v1", JSON.stringify(records));
	localStorage.setItem("demo-before-key-change", localStorage.getItem("demo-subscribes") ?? "0");
}

/** Simulate a push-service expiration and the worker's durable marker, without bypassing backend sign-in. */
export async function markBetaPushExpired(): Promise<void> {
	const records = JSON.parse(localStorage.getItem("aiki.push-subscriptions.v1")!) as BrowserPushState["records"];
	const scope = records.beta!.scope;
	const subscriptions = JSON.parse(
		localStorage.getItem("demo-push-subscriptions")!,
	) as BrowserPushState["subscriptions"];
	delete subscriptions[location.origin + scope];
	localStorage.setItem("demo-push-subscriptions", JSON.stringify(subscriptions));
	const request = indexedDB.open("aiki.push-sync.v1", 1);
	request.onupgradeneeded = () => request.result.createObjectStore("scopes");
	const db = await new Promise<IDBDatabase>((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
	const transaction = db.transaction("scopes", "readwrite");
	transaction.objectStore("scopes").put(crypto.randomUUID(), scope);
	await new Promise<void>((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () => reject(transaction.error);
	});
	db.close();
	navigator.serviceWorker.dispatchEvent(
		new MessageEvent("message", { data: { type: "notifications-changed", scope } }),
	);
}

/** Place all backend statuses in view and wait for the theme/layout paint before capturing a screenshot. */
export async function showBackendPushSettings(theme: string, recording = false): Promise<void> {
	document.documentElement.classList.toggle("dark", theme === "dark");
	[...document.querySelectorAll("h3")]
		.find((heading) => heading.textContent === "Backends")!
		.scrollIntoView({
			block: recording ? "center" : "start",
			behavior: recording ? "smooth" : "instant",
		});
	await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}
