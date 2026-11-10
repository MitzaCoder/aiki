import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

/** Only this public, non-secret namespace reaches the bundle. No private env file is copied to the build. */
export function legacyStoragePrefix(env: Record<string, string | undefined> = process.env, root = fileURLToPath(new URL('../..', import.meta.url))): string {
	const file = env.AIKI_WEB_ENV_FILE || join(env.DEPLOY_CONFIG_DIR || join(root, 'deploy/local'), 'web.env');
	const prefix = env.AIKI_LEGACY_STORAGE_PREFIX ?? (existsSync(file) ? parseEnv(readFileSync(file, 'utf8')).AIKI_LEGACY_STORAGE_PREFIX : '') ?? '';
	if (prefix && !/^[a-z0-9][a-z0-9.-]*$/i.test(prefix)) throw new Error('Invalid legacy storage namespace');
	return prefix;
}
