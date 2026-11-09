/**
 * A provider with an OAuth login, for tests. The flow mirrors the real ones: a select, an auth URL notification, and a
 * `manual_code` prompt whose answer is checked. No network, no callback server.
 */
import { createProvider, type OAuthAuth, type Provider } from "@earendil-works/pi-ai";
import { lazyApi } from "@earendil-works/pi-ai/api/lazy";

export const FAKE_PROVIDER_ID = "fake-subscription";
export const FAKE_GOOD_CODE = "fake-good-code";
export const FAKE_ACCESS_TOKEN = "fake-access-token";
export const FAKE_REFRESH_TOKEN = "fake-refresh-token";

export type FakeOAuthControls = {
	loginCalls: number;
	aborts: number;
	lastDeviceId: string | undefined;
	lastAgentName: string | undefined;
};

export function fakeOAuthProvider(): { provider: Provider; controls: FakeOAuthControls } {
	const controls: FakeOAuthControls = {
		loginCalls: 0,
		aborts: 0,
		lastDeviceId: undefined,
		lastAgentName: undefined,
	};

	const oauth: OAuthAuth = {
		name: "Fake Subscription (OAuth)",
		isSubscription: true,
		loginLabel: "Sign in with Fake",
		async login(interaction, options) {
			controls.loginCalls += 1;
			controls.lastDeviceId = options?.getDeviceId?.();
			controls.lastAgentName = options?.agentName;
			interaction.signal.addEventListener("abort", () => {
				controls.aborts += 1;
			});

			const method = await interaction.prompt({
				type: "select",
				message: "Select a fake login method:",
				options: [
					{ id: "browser", label: "Browser login" },
					{ id: "fail", label: "A login that fails" },
				],
			});
			interaction.notify({
				type: "info",
				message: "Fake login started",
				links: [{ url: "https://fake.example/help", label: "Fake help" }],
			});
			interaction.notify({
				type: "auth_url",
				url: "https://fake.example/authorize?code_challenge=fake-challenge",
				instructions: "Open the fake sign-in page.",
			});
			const code = await interaction.prompt({
				type: "manual_code",
				message: "Paste the fake code or redirect URL:",
				placeholder: "https://fake.example/callback?code=…",
				signal: interaction.signal,
			});
			if (method === "fail") throw new Error("The fake provider rejected this login");
			if (code !== FAKE_GOOD_CODE) throw new Error("The fake code was rejected");
			interaction.notify({ type: "progress", message: "Exchanging the fake code for tokens" });
			return {
				type: "oauth",
				access: FAKE_ACCESS_TOKEN,
				refresh: FAKE_REFRESH_TOKEN,
				expires: Date.now() + 3_600_000,
			};
		},
		async refresh(credential) {
			return credential;
		},
		async toAuth(credential) {
			return { apiKey: credential.access };
		},
	};

	const provider = createProvider({
		id: FAKE_PROVIDER_ID,
		name: "Fake Subscription",
		auth: { oauth },
		models: [],
		api: lazyApi(async () => {
			throw new Error("the fake subscription provider has no streaming");
		}),
	});

	return { provider, controls };
}
