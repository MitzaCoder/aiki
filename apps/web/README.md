# web

The app: a SvelteKit app built as a pure single-page app
(`adapter-static` with a `200.html` fallback, `ssr = false`). It is
deployed separately from every backend and talks to them over WebSockets.
Caddy serves the build in production; no backend serves it.

Generated with `sv create` (minimal template, TypeScript),
`sv add sveltekit-adapter="adapter:static"` and `sv add tailwindcss`.
Styled with shadcn-svelte (Tailwind CSS 4, `components.json`, components in
`src/lib/components/ui`). Light and dark follow the system setting through
a `.dark` class set in `src/app.html`; the theme variables live in
`src/app.css`.

## Developing

```sh
bun install
bun run dev      # http://localhost:5173
```

Add a backend in the app (for local work, `http://127.0.0.1:7317`) and start
the backend with the dev origin allowed:

```sh
AIKI_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173 bun run start
```

Backends are stored per browser as name + HTTPS origin (plain HTTP only for
localhost). The app keeps one connection per backend and routes projects as
`/b/<backend>/projects/<project>`.

## Published backends and connect links

`deploy/backends.json` is the list of backends this app is offered to a new
browser. `vite-plugin-published-backends.ts` publishes it as `/backends.json`
(dev server middleware; an emitted asset in the build, so it lands in the app
release next to `200.html`). It is optional: absent or unreadable means no
suggestions. The parse and the address helpers are in
`src/lib/published-backends.ts` (unit tested in
`test/published-backends.test.ts`).

`/connect` is the landing page for a link made on another device. The link is
`<app origin>/connect#<encoded backends>`; the payload (`v1.` + base64url of
`name<TAB>origin` lines) never leaves the fragment. Codec and its strict
validation (HTTPS origins only, length limits) are in `src/lib/connect.ts`,
tested in `test/connect.test.ts`; the QR code is drawn by `uqr`. The route is
prerendered, so the build also writes `connect.html` — a direct visit works
with or without the SPA fallback.

## Installable app and push notifications

Two manifests install the app: `static/manifest.webmanifest` (dark) and
`static/manifest-light.webmanifest`, linked from `src/app.html` with
`media="(prefers-color-scheme: …)"` because a manifest can only carry one
theme/background pair. Both name the same icons: 192 and 512, plain and
`maskable`, plus `icons/badge-96.png` for the status bar. They are drawn by
`scripts/generate-icons.ts` from the orb's gradient — `bun run icons`
regenerates them, and `test/manifest.test.ts` checks the files, the sizes and
that the colours still match the jarvis theme.

`src/service-worker/index.ts` is a module worker. SvelteKit registers it on
load (and `notifications.svelte.ts` registers it with `type: 'module'` too):
HTML is network-first, falling back to the precached `200.html` shell (the
adapter's fallback) only when the network fails or stalls, so a deploy is
seen at the next load; `_app/immutable` is cache-first in a cache named after
the build version, and other same-origin GETs are network-first. The worker
shows a push from its JSON `NotificationPayload`, and a notification click
focuses an open window and navigates it to the payload's route (built from
`backendKey` + project/worker/schedule; see `notificationUrl` in
`packages/client`), or opens one. `pushsubscriptionchange` re-registers the
new subscription with every backend it was told about — the page hands it
those registrations with `postMessage`, and the worker keeps them in a Cache.

The Notifications page (`/notifications`) enables push for this browser, lists
what each backend knows about the device (registered, no feature, failed, key
mismatch), chooses the event kinds, sets quiet hours in the device's
timezone, sends a test notification with the push service's answer, and
lists muted projects. A project is muted from the bell in its chat header;
preferences live in this browser (`localStorage`, one device ID) and are
pushed to every backend, with muted project IDs kept per backend. Presence
(visible, current project) goes to each registered backend on connect, on
route changes and on `visibilitychange`.

## Checking and building

```sh
bun run check    # svelte-check, then tsc for the service worker (its own tsconfig)
bun run build    # static output in build/
bun run preview  # serve the build locally
```

More shadcn-svelte components: `bunx shadcn-svelte@latest add <name>`. The
CLI writes into `#lib/components/ui` (see `components.json`); `bunx
shadcn-svelte@latest init` needs a `--preset <code>` because the
interactive preset picker is not scriptable — `bIkeymG` is the "vega"
preset (Inter, neutral, lucide) this app started from; the app now uses Atkinson Hyperlegible Next for text.

The build has no prerendered pages; the static host must answer unmatched
routes with `200.html`.
