# Add a dev-mode launchd agent for develemit-hq
**Difficulty:** 2

> _Optional / lowest priority in this initiative — sprints 310-313 deliver the
> self-healing behaviour on their own. This adds survival across logout and
> reboot. Drop it without consequence if the supervisor proves sufficient._

## Goal
develemit-hq starts at login and survives a reboot, running in **dev** mode
under the supervisor, without giving up hot reload or the existing production
service path.

> _Target repo: `~/projects/develemit-hq` (a separate repo from emit-infra)._

## Reason
Sprint 310's supervisor keeps the server alive while the supervisor itself is
running — but it runs in a terminal. Close the terminal, log out, or reboot, and
nothing brings the dashboard back. Since develemit-hq is the thing the user
checks *to find out whether other things are broken*, it is the one server
worth making genuinely always-on.

A launchd agent already exists for this repo and has never been installed:
`launchctl list` shows only `com.emit.ghcr-prune` and
`com.emit.metrics-collector`; `com.develemit.hq` is absent. The reason not to
just install it as-is is that `scripts/install-macos-service.sh` points at
`scripts/serve-remote.sh`, which runs `pnpm build && pnpm start` — i.e.
**production** mode. Installing it today would drop hot reload and run straight
into the known Next build problem on this machine.

## Context

### The existing installer, and what to keep from it
`scripts/install-macos-service.sh` already gets the hard parts right — reuse
its structure rather than writing a new one:
- `Label` `com.develemit.hq`, plist at `~/Library/LaunchAgents/`
- `KeepAlive` with `Crashed: true` / `SuccessfulExit: false`
- `ThrottleInterval: 10` to avoid restart storms
- `RunAtLoad: true`
- Wraps in `/usr/bin/caffeinate -i` so the host will not idle-sleep
- Explicit `PATH` built from the resolved `pnpm`/`node` locations, because
  launchd jobs get a minimal environment
- Unloads any prior version before writing the new plist
- Refuses to run unless `.env.local` with `DASHBOARD_PASSWORD` exists

### Two layers, and why that is correct
The right composition is **launchd → supervisor → server**:
- the supervisor (sprint 310) catches the server dying while the supervisor
  lives — the health-probe case,
- launchd catches the supervisor itself dying, plus login/reboot.

Each covers the other's blind spot. Point the plist at the supervisor-wrapped
dev command, not at `tsx server.ts` directly.

### Do not break the production path
`serve-remote.sh` and `pnpm start` are the production/remote-access path,
documented in the repo's `REMOTE.md`. This sprint must not repurpose or alter
them. Either add a `--dev` flag to the existing installer or add a separate
dev installer — decide which, and make sure it is obvious to a reader which
mode a given plist runs.

If both a dev and a prod agent could be installed at once they would fight over
port 9000. Prevent that: same `Label` (so one replaces the other), or an
explicit check that refuses to install one while the other is loaded.

### Logging
Sprint 310 already writes `~/.local/log/develemit-hq.log` via the supervisor.
launchd's `StandardOutPath`/`StandardErrorPath` should go somewhere that does
not fight it — either the same fleet convention with a distinct name (e.g.
`~/.local/log/develemit-hq-launchd.log`) or the repo-root `.develemit.log` the
current installer uses. Do not have two writers on one file.

Neither launchd nor this repo rotates logs today (`metrics-collector.log` is
already 7.4 MB). Whatever file launchd writes should be covered by the same
rotation story sprint 310 established, or explicitly noted as unrotated.

## Tasks
1. Decide dev-vs-prod selection: a `--dev` flag on the existing installer, or a
   separate script. Document the choice in the script header.
2. Generate a plist whose `ProgramArguments` run the **supervised dev** command
   from sprint 312, wrapped in `caffeinate -i`.
3. Preserve `KeepAlive`, `ThrottleInterval`, `RunAtLoad`, the explicit `PATH`,
   the unload-before-install step, and the `.env.local` precondition check.
4. Prevent a dev and prod agent from being loaded simultaneously.
5. Point launchd's stdout/stderr somewhere that does not collide with the
   supervisor's own log file.
6. Install it, then verify for real: `launchctl list | grep develemit` shows
   it, port 9000 answers, and hot reload still works (edit a file, see it
   recompile).
7. Verify restart-on-death at the launchd layer: kill the **supervisor** and
   confirm launchd brings the whole stack back.
8. Document install / status / stop / uninstall commands in the repo's
   `REMOTE.md` (or the doc that currently covers the service).

## Files involved
- `~/projects/develemit-hq/scripts/install-macos-service.sh` — dev mode, or a
  sibling script
- `~/Library/LaunchAgents/com.develemit.hq.plist` — generated, not committed
- `~/projects/develemit-hq/REMOTE.md` (or equivalent) — documented commands

## Acceptance criteria
- [ ] Installing the dev agent yields a loaded `com.develemit.hq` and a
      responding dashboard on port 9000 — paste `launchctl list` output and a
      health check.
- [ ] Hot reload still works under the agent (demonstrate an edit recompiling).
- [ ] Killing the supervisor causes launchd to restart the whole stack.
- [ ] The production path (`pnpm start` / `serve-remote.sh`) is unchanged and
      still works.
- [ ] Dev and prod agents cannot both be loaded at once.
- [ ] launchd's log destination does not collide with
      `~/.local/log/develemit-hq.log`.
- [ ] Install / status / stop / uninstall are documented.
- [ ] Committed in develemit-hq.

## Out of scope
- A launchd agent for the emit-infra API. It is actively developed and lives in
  a terminal by choice; the supervisor from sprint 311 is sufficient. Revisit
  only if it proves otherwise.
- Any change to sprint 310's supervisor.
- Fixing the `next-swc` / Turbopack panic.
- Clamshell/sleep behaviour beyond the `caffeinate -i` the existing script
  already applies.
