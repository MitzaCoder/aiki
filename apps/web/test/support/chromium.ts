import { pathToFileURL } from 'node:url';

export const CHROMIUM_TIMEOUT_MS = 90_000;

export function chromiumArguments(document: string, profile: string, noSandbox: boolean): string[] {
	return [
		'--headless', '--disable-gpu', '--disable-dev-shm-usage',
		'--no-first-run', '--no-default-browser-check', '--disable-background-networking',
		'--disable-component-update', '--disable-breakpad',
		...(noSandbox ? ['--no-sandbox'] : []),
		`--user-data-dir=${profile}`, '--dump-dom', pathToFileURL(document).href,
	];
}

/** A real browser, never a DOM mock or availability skip. Own the whole process group and drain both pipes. */
export async function renderChromiumDocument(
	document: string,
	profile: string,
	options: { binary?: string; timeoutMs?: number; noSandbox?: boolean } = {},
): Promise<string> {
	const binary = options.binary ?? process.env.CHROMIUM_BIN ?? Bun.which('chrome-headless-shell') ?? Bun.which('chromium');
	if (!binary) throw new Error('Chromium is required: set CHROMIUM_BIN or run scripts/setup-test-browser.sh');
	const timeoutMs = options.timeoutMs ?? CHROMIUM_TIMEOUT_MS;
	const noSandbox = options.noSandbox ?? (process.getuid?.() === 0 || process.env.CHROMIUM_NO_SANDBOX === '1');
	const browser = Bun.spawn([binary, ...chromiumArguments(document, profile, noSandbox)], {
		stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', detached: true,
		// A downloaded headless shell does not need the runner's inherited desktop session/bus configuration.
		env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: 'unix:path=/nonexistent-test-session-bus' },
	});
	const killOwnedGroup = () => {
		try {
			if (process.platform === 'win32') browser.kill('SIGKILL');
			else process.kill(-browser.pid, 'SIGKILL');
		} catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
	};
	let timedOut = false;
	const timer = setTimeout(() => { timedOut = true; killOwnedGroup(); }, timeoutMs);
	try {
		const [code, output, error] = await Promise.all([
			browser.exited, new Response(browser.stdout).text(), new Response(browser.stderr).text(),
		]);
		if (timedOut || code !== 0) {
			throw new Error(`Chromium ${timedOut ? `timed out after ${timeoutMs}ms` : `exited ${code}`} (${binary})\n${error.slice(-8000)}`);
		}
		return output;
	} finally {
		clearTimeout(timer);
		killOwnedGroup();
	}
}
