import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { pushWorker } from './vite-plugin-push-worker.ts';
import { publishedBackends } from './vite-plugin-published-backends.ts';
import { legacyStoragePrefix } from './vite-legacy-storage.ts';

// The app is a static SPA, deployed separately from every backend. It connects to the
// backends the user configures, so there is no proxy: `vite dev` serves the app and
// the browser opens each backend's socket directly.
export default defineConfig(() => {
	return {
		define: { __KEMIRI_LEGACY_STORAGE_PREFIX__: JSON.stringify(legacyStoragePrefix()) },
		plugins: [
			tailwindcss(),
			pushWorker(),
			// Untracked `deploy/local/backends.json` becomes `/backends.json` beside the app (see the plugin).
			publishedBackends(),
			sveltekit({
				compilerOptions: {
					// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
					runes: ({ filename }) =>
						filename.split(/[/\\]/).includes('node_modules') ? undefined : true
				},
				// SPA: no prerendered routes, so every URL is answered by the fallback
				// page, which loads the app and navigates to the requested route.
				// See https://svelte.dev/docs/kit/single-page-apps
				adapter: adapter({ fallback: '200.html' })
			})
		]
	};
});
