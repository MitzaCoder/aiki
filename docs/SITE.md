# kemiri.dev

`site/` is a complete static site: HTML, CSS, local images, `/privacy/` (also reachable
as `/privacy` on Pages), and `/install.sh`. No JavaScript, build, analytics, external
fonts or CDN is needed. The hero images are exact copies of the synthetic README
images in `docs/assets/readme/`; update both together. System light/dark preference
selects the image and palette. The app/backend deployment is unrelated.

## Owner setup (not done by this change)

After this change is merged/pushed to main:

1. In the public repository's **Settings → Pages → Build and deployment**, select
   **GitHub Actions** as the source. Do not select a branch/Jekyll build.
2. In **Settings → Environments → github-pages**, restrict deployment branches to
   `main` (and set any desired approval rule). The workflow also refuses to deploy
   from a manually selected non-main ref.
3. Run **Actions → Website → Run workflow** on `main` for the first deployment.
   Later changes under `site/` or to the workflow/checks trigger it automatically.
4. Add `kemiri.dev` to Cloudflare and set its assigned nameservers at the
   registrar. Wait for delegation; keep the old `aikilabs.dev` registration/zone.
5. Verify the new domain with GitHub's requested Pages ownership TXT record; keep
   that record. In **Settings → Pages**, set custom domain **kemiri.dev**, matching
   `site/CNAME`. A custom Actions workflow does not set the account's domain.
   Configure apex/www DNS using GitHub's current
   [Pages instructions](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site).
   Start DNS-only while Pages validates and provisions its certificate, then enable
   **Enforce HTTPS**. Check `/`, `/privacy/` and `/install.sh` on the new domain.
6. Enable Cloudflare Email Routing on the new zone, verify the destination mailbox,
   and create `support@kemiri.dev`. Add its required MX/TXT/SPF records. Preserve
   `support@aikilabs.dev` forwarding to the same verified mailbox; test both.
   Routing is inbound forwarding, not outbound sending. The site does not read mail.
7. Once the new HTTPS site works, put only the old apex and `www.aikilabs.dev`
   HTTP DNS records behind Cloudflare's **proxied** redirect-only setup. Ensure
   edge HTTPS certificates are active. Create a **Single Redirect** matching
   `http.host in {"aikilabs.dev" "www.aikilabs.dev"}` for both HTTP and HTTPS.
   Dynamic target: `concat("https://kemiri.dev", http.request.uri.path)`;
   enable **Preserve query string**. Rehearse with 302, then use **301** after
   testing `/privacy/`, `/install.sh` and a path with a query. Do not match arbitrary
   subdomains, redirect back to the old host, or remove old mail MX/TXT records.
8. After the GitHub repository rename to `MitzaCoder/kemiri`, review Pages and
   integration settings and canonical remotes. Keep checkout locations unchanged;
   never reuse the old repository name. Test old release API and asset redirects.
   This cutover does not move app/API origins, paired backends or OAuth callbacks.

The workflow uses immutable action SHAs. The upload job only reads contents;
only the deployment job can write Pages and request the deployment OIDC token.
There is no repository-content write permission, automatic commit or release sync.
The uploaded artifact is exactly `site/`, not the checkout or its local configuration.

## Installer trust model

Pages cannot provide HTTP redirects, so the domain serves a small, reviewable POSIX
shell **bootstrap**, not a second copy of the full installer that might silently
drift from the release. Download/review it before running; do not use `curl | sh`.

- The default is pinned to `v0.1.0-pilot.3`, never GitHub's `latest` (which excludes
  prereleases). `--version TAG` selects that exact release's installer and is passed
  unchanged to it. `--version latest`, path fragments and URLs are rejected.
- It downloads `install.sh` and `install.sh.sha256` only from that version under
  `https://github.com/MitzaCoder/kemiri/releases/download/`, requiring HTTPS even
  through redirects, bounded curl downloads, and SHA-256 before execution.
- It accepts exactly one checksum entry for `install.sh`, not arbitrary local paths.
  Missing assets, malformed checksums and mismatches stop before running anything.
  Downloads live in a private temporary directory and are removed on exit.
- Other arguments pass through, including `--no-service`, `--dir`, `--runtime`,
  `--ref`, and the release installer's existing archive/base-URL test options.
  Those options do not change where the bootstrap obtains its installer.
- The release installer retains its own archive/runtime checksum verification.
  No production environment variable can replace the bootstrap's download host.

This is corruption detection over HTTPS, **not a signature**, and not protection
against a compromised GitHub publisher or a malicious change to the website's
bootstrap. Trust includes the website deployment, release publisher, GitHub and
local tools. People who want to inspect the full verified release installer before
execution should use the direct GitHub commands in [INSTALL.md](INSTALL.md) or the
preferred agent path in [AGENT-INSTALL.md](AGENT-INSTALL.md).

For a new pilot, review the published release and checksum assets first, then
change the pinned default in `site/install.sh`, the site commands/APK/release links,
and the installation docs together in a reviewed commit. No release workflow
silently changes the website or its pinned version.

## Local checks and preview

```sh
bun scripts/check-site.ts
bun test scripts/site.test.ts
python3 -m http.server 8080 --bind 127.0.0.1 --directory site
```

The checker resolves local HTML links, assets and fragments without external
network requests. Tests dry-run the bootstrap against a synthetic local release
server using a **test-only curl shim**; they check argument/version forwarding,
exit codes, invalid/missing/mismatched checksums and temporary-file cleanup.
No real install, service, provider account or release is used.
