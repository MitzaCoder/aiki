/**
 * The deploy exports its machine configuration (deploy/local/config.env: DEPLOY_STATE_DIR, DEPLOY_WATCH_SERVICE, …) and
 * then runs this test suite. Those values must not leak into the scripts under test, which would then read the real
 * state directory and config instead of their temporary ones. Import this module first in every deploy test.
 */
const MACHINE_CONFIGURATION = /^(DEPLOY_[A-Z0-9_]+|AIKI_[A-Z0-9_]+|KEMIRI_[A-Z0-9_]+)$/;

for (const name of Object.keys(process.env)) {
	if (MACHINE_CONFIGURATION.test(name)) delete process.env[name];
}
