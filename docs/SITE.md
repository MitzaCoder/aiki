# kemiri.dev

`site/` is a complete static site: HTML, CSS, local images, `/privacy/` (also reachable
as `/privacy` on Pages), and `/install.sh`. No JavaScript, build, analytics, external
fonts or CDN is needed. The hero images are exact copies of the synthetic README
images in `docs/assets/readme/`; update both together. System light/dark preference
selects the image and palette. The app/backend deployment is unrelated.

## Live site and owner operations

The owner completed GitHub Pages and the domain cutover: **https://kemiri.dev**
is live, HTTPS is enforced, and **https://kemiri.dev/install.sh** returns 200.
The former install host returns 404; never send users there. The public contact
is **support@kemiri.dev**. This changes marketing/install URLs only, not app/API
origins, paired backends, OAuth callbacks, checkout paths or deployment units.

Pages uses GitHub Actions, not a branch/Jekyll build. Keep its deployment
environment restricted to main, the Pages ownership TXT record, custom domain
matching site/CNAME and Enforce HTTPS enabled. Review the current
[Pages DNS instructions](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)
before changing records. After any site deployment, check /, /privacy/ and
/install.sh over HTTPS. Mail routing is owner-managed inbound forwarding; the
site does not read mail or send messages. Test support delivery separately.

The workflow uses immutable action SHAs. The upload job only reads contents;
only the deployment job can write Pages and request the deployment OIDC token.
There is no repository-content write permission, automatic commit or release sync.
The uploaded artifact is exactly `site/`, not the checkout or its local configuration.

## Pilot.5 publication and live domain

The bootstrap and download links are pinned to the published pilot.5 release.
The current install command is `curl -fsSL https://kemiri.dev/install.sh | sh`.
Prefer downloading and reviewing it before execution. For a new release, change
the pinned version and links only after its public assets and checksums verify.

## Installer trust model

Pages cannot provide HTTP redirects, so the domain serves a small, reviewable POSIX
shell **bootstrap**, not a second copy of the full installer that might silently
drift from the release. Download/review it before running; do not use `curl | sh`.

- The default is pinned to `v0.1.0-pilot.5`, never GitHub's `latest` (which excludes
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
