# Kemiri

Read `docs/CONTINUE.md` first; update it before finishing.

A harness based on pi durable.

## Stack

- TypeScript on Bun: `bun install`, `bun run`, `bun test`. Don't use npm,
  pnpm or node to install or run anything.
- Bun workspaces: `packages/protocol`, `packages/client`,
  `packages/server`, `apps/web` (layout and rules in `docs/DESIGN.md`).

## Commits

- Conventional Commits style (`feat:`, `fix:`, `docs:`, …).
- Author: as set in the repo's jj/git config.
- Link commits to tasks with a `Kemiri-Task: T…` trailer.
- Moving the `main` bookmark deploys the app on this host and the backends
  here and on configured remote hosts (`deploy/`). Move it only to commits whose checks
  pass: `bun test`, `bun run typecheck`, and `bun run check` plus
  `bun run build` in `apps/web`.
- Deploy only by moving `main`; the watcher does the rest. Never run
  `deploy/*.sh` or `systemctl` on `aiki` from a tool: when the
  harness runs you, that restarts the server under the deploy and kills it
  before its health check and rollback. After moving `main`, end the turn;
  the deploy holds new tool calls and restarts once none is running. Its outcome shows in the app.

## Public-source hygiene

Committed files must never contain personal infrastructure (hosts, IPs, domains, device serials or home paths),
employer/work details, credentials, or real session data. Keep these in ignored local configuration or agent memory.
Use reserved example domains and synthetic fixtures. Do not paste private guard terms into source or reports committed
here. Run `bun scripts/check-public.ts` before every public push; review the exact refs being pushed as well.
