---
name: html-artifacts
description: Create polished HTML reports, proof indexes, dashboards and slide decks using Kemiri templates, theme tokens and safe publishing rules.
---
# HTML artifacts

Use HTML for visual comparisons, interactive charts, dashboards or slides; Markdown for short prose, logs and code reviews. User and project design rules win.

Copy and fill a sibling template: `report.html` (verdict, findings, evidence), `proof-index.html` (tagged before/after media, checks), `dashboard.html` (metrics, CSS chart, table), `deck.html` (keyboard slides). Read only the template needed. Keep its inline CSS; replace synthetic content, labels and numbers, not just the title. One focal heading, restrained accent, generous space, readable lines under 80ch. Simple charts use CSS/SVG, not a library.

Theme defaults are in `tokens.css` and already inline in every template. Use the app's `--tone-bg`, `--tone-surface`, `--tone-surface-2`, `--tone-border`, `--tone-border-strong`, `--tone-fg`, `--tone-fg-muted`, `--tone-primary`, `--tone-primary-fg`, `--tone-success`, `--tone-warning`, `--tone-danger`, `--tone-ring`, `--tone-radius`; type `--font-sans`, `--font-mono`, `--text-task` (15px), `--text-task-sm` (13px), spacing `--spacing` (4px). Light: background #fbfaff, text #1a1830, primary #6366f1; dark: #09090f, #ecebf5, #818cf8. Templates support `prefers-color-scheme` and explicit `[data-theme="light|dark"]`; the viewer injects current app defaults. Keep fallbacks in the low-priority CSS layer so injection wins; custom author colours may override it.

Deliver one self-contained UTF-8 HTML file, with doctype, lang, title and viewport. Inline CSS, scripts and media. No relative links or asset paths: use fragment IDs, embedded data or absolute HTTPS. Links open outside the artifact (new tabs on web); use `#ids` for in-page navigation. Email/telephone links need a device handler; web also offers the address to copy. Responsive at 360px, no horizontal page overflow. Print CSS must show all content/slides, hide controls, avoid clipped tables, and use white paper. Use semantic headings, alt text, keyboard focus, visible labels, reduced motion and accessible text contrast. Do not use the subtle tone for small text. No external fonts; Google Fonts is optional only when CSP is off. Never depend on browser storage, cookies, parent DOM or credentials: the preview has an opaque origin.

Optional CDN scripts, only these exact cdnjs paths under `https://cdnjs.cloudflare.com/ajax/libs/`:
- `Chart.js/4.4.1/chart.umd.js`
- `mermaid/10.9.1/mermaid.min.js`
- `highlight.js/11.11.1/highlight.min.js`

Read `cdn.json` for verified SHA-384 integrity values; add `integrity` and `crossorigin="anonymous"`. No latest URLs, other CDNs, dynamic imports or plugin fetches. The opt-in viewer CSP blocks connections and forms; images/media/CDN requests can still send data. Prefer no network.

Write the file in the workspace or temp directory, then call `artifact_save({path, title, taskId, tags})`; omit taskId only for non-task work. Use synthetic/public data only. Inspect the rendered page in light/dark, narrow and print layouts. To revise, edit the same file and save the same path/name again; use the returned artifact/version reference, never assume it is unchanged.
