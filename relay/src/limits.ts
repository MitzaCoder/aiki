/** Pilot ceilings; operators may replace individual values in relayControl/settings. */
export const DEFAULT_LIMITS = {
	routeMinute: 30,
	routeDay: 500,
	accountMinute: 60,
	accountDay: 2000,
	ipMinute: 120,
	ipDay: 5000,
	managementMinute: 10,
	managementDay: 200,
	requestMinute: 30,
	accountChallengeHour: 3,
	accountChallengeDay: 10,
	ipChallengeHour: 10,
	ipChallengeDay: 20,
	enrollmentDay: 20,
	newAccountIpDay: 5,
	newAccountDay: 20,
	activeAccounts: 100,
	activePhones: 300,
	relaySendDay: 5000,
	relayChallengeDay: 100,
	accountPhones: 3,
	phoneRoutes: 8,
	accountRoutes: 24,
	pendingChallenges: 3,
};
export type Limits = typeof DEFAULT_LIMITS;
export type LimitName = keyof Limits;
