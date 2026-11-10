# DeepSeek Harness (dsh): Agent Teams

How dsh's lead-and-teammates model compares with our coordinator and workers, and what is worth taking from it.
Nothing here is decided; `docs/DESIGN.md` links the candidates from the sections they would change.

Read on 2026-11-04 from [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (`master`,
latest release `dsh-v0.2.2-alpha.3`). dsh is in developer preview and breaks compatibility often, so check the sources
before relying on a detail:

- `packages/team/agent-team/README.md`: usage, design and known limitations.
- `docs/subsystems/agent-team.md`: the task and projection types.
- `docs/subsystems/subagent.md`: the subagent tree that Teams builds on.
- `docs/upgrade-guide/v0.2.1-rc.2/agent-team-subagents/guide.md`: why the team roster and mailbox were removed.
- `packages/preset/README.md` and `.agents/notes/implemented/architecture/2026-09-18-declarative-agent-presets.md`:
  agent presets.
- Release notes `dsh-v0.1.7-rc.1` (2026-09-23, Team panel), `dsh-v0.2.1-alpha.3` (2026-10-14, a preset per spawned
  subagent) and `dsh-v0.2.1-rc.2` (2026-10-17, Team mode per root Session, roster and mailbox replaced by plain
  subagent tools).

## What dsh has

- **Lead and teammates.** The root Session is the Lead. Teammates are ordinary subagents: `subagent` starts one fresh,
  `subagent_fork` inherits the Lead's completed turns. Every agent is addressed by its Session id; descriptions are only
  labels. Team mode is chosen per root Session, off by default, and the whole tree shares it.
- **A durable task board.** Tasks live in the Lead's session log as a DAG. Each change stores a whole snapshot (`id`,
  `revision`, `subject`, `description`, `status`, `ownerId`, `blockedBy`, `writeScopes`). `revision` is
  compare-and-set, so a stale update fails instead of overwriting newer work. `blockedBy` must name live tasks and stay
  acyclic, and a task can be claimed only when its blockers are complete. `writeScopes` are path prefixes that only warn
  when two in-progress tasks overlap. At most `maxTasks` (256) tasks.
- **Authority.** Any member creates, claims, completes, releases or reopens tasks. Only the Lead reassigns.
- **Messaging.** `list_agents`, `send_message`, `interrupt_agent` (ancestors only) and `wait_agent`, which waits on the
  caller's inbox. Members can message each other across branches of the tree. Task changes wake no one, so an agent
  that should act on one has to be messaged.
- **Presets per subagent.** A spawned subagent can run under its own agent preset: a revisioned declaration of its
  tools, prompt sections and skills, plus a model, reasoning effort and output limit per spawn.

dsh's README lists these limits itself:

- Members share one checkout: no worktree, remote member, merge or filesystem lock. Write scopes are advisory, and
  "Leads must coordinate ownership and review the final diff".
- Notices reach live local members only. Cold members are not restored and idle members stay idle until resumed.
- Inactivity, interruption, process exit and failed work never release a task's owner.
- Every task change sends the whole board to connected browsers.

## Compared with our coordinator and workers

| | dsh Agent Teams | Ours |
| --- | --- | --- |
| Roles | The Lead keeps every tool and can claim tasks itself; the board is shared by peers | The coordinator plans, delegates and reviews; workers edit; worker tools refuse to run outside the coordinator |
| Communication | Any member to any member, by Session id | Star: only the worker's final report enters the coordinator's context |
| Isolation | One shared checkout | `shared` or a jj workspace per worker, merged by change ID |
| After a restart | Interrupted work shows "Task stopped"; cold members are not restored | The background anchor and reporter tasks resume; reports and messages are idempotent by tool call ID |
| Keeping watch | The Lead has to poll or be messaged | Durable check-ins with bounded digests (`worker_peek`, `[check-in]`) |
| Worker setup | A named preset of tools, prompt sections and skills, plus model and effort per spawn | Model and thinking per spawn or per message; the coordinator's agent is copied, the worker extension removed and the instructions replaced |
| Board | Task DAG with CAS revisions, blockers and write-scope warnings | A flat worker list (`aiki.workers`); the planned board has no dependencies yet |

They made the opposite trade from us: dsh invested in the board and left the workspace shared, while we invested in
the workspace (isolation and merge) and in durability, which comes from pi durable. The hierarchy is also deliberate
on both sides. dsh's peer board scales to many members, and our star keeps the coordinator's context bounded and the
user talking to one agent.

## Worth taking

1. **Board tasks with a revision and dependencies.** Give the board's rows (see Board in `docs/DESIGN.md`) a
   compare-and-set `revision`, `blockedBy` links to other rows and advisory write scopes that warn on overlap. A flat
   list cannot say "worker B waits for worker A". This needs no new machinery: the board is already a pi durable
   document, and each change can store the whole row with its revision.
2. **Worker presets.** Let `worker_spawn` take a named preset (a bundle of tools, prompt sections and skills) instead
   of only replacing the worker's instructions as text. A reviewer preset without `write`, `edit` or `bash` cannot
   change files, rather than merely being told not to. pi durable's per-conversation extension and tool selection
   (`configure`) already supports it.

## Not taking

- **Peer messaging between workers.** It breaks the star that keeps the coordinator's context to reports only.
- **A shared checkout by default.** The coordinator already picks `shared` per worker when that is enough.
