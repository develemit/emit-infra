# Deploy gates

↩ back to [the shared pre-push hook overview](PRE-PUSH-HOOK.md).

The deploy phase is skipped, in this order:

1. **Not pushing to `main`** — CI only.
2. **`ci.ghcrOrg` unset** — nothing to push images to.
3. **Dry run** — see below.
4. **Only ignored paths changed** — see below.
5. **Unattended shell** — refuses (not skips: exits non-zero) — see below.

`EMIT_FORCE_DEPLOY=1` overrides gates 3 and 4. Use it after an env-only change,
since `.env` files are gitignored and invisible to the path diff. It does
**not** override gate 5 — see [Unattended-shell gate](#unattended-shell-gate)
for why that's deliberate.

## `git push --dry-run`

Git runs pre-push hooks for a dry run and gives the hook **no** way to tell,
via env, argv, or stdin. A dry run therefore used to run CI, log into GHCR, and
build and push images for real.

**Chosen mitigation:** read the invoking `git push` process's argv. The hook is
a child of that process, so `ps -o args=` still shows `--dry-run` / `-n`.
`detect_dry_run_push` walks up to 5 ancestors looking for the `push` command.

Tradeoffs considered:

- **argv inspection (chosen)** — accurate, zero friction on a normal push, and
  covered by an end-to-end test that runs a real `git push --dry-run`. Relies on
  `ps`, so it's POSIX-ish but not universal; if `ps` returns nothing the hook
  proceeds and deploys, preserving today's behavior rather than blocking a
  legitimate push.
- **Confirmation prompt** — reliable, but adds a prompt to every deploy and
  breaks non-interactive pushes. Available opt-in as `EMIT_DEPLOY_CONFIRM=1`
  (prompts on `/dev/tty`, defaults to *no*).
- **Move deploy out of pre-push** (e.g. to a `post-push` or a manual
  `emit-infra deploy`) — the real fix, since pre-push is the wrong lifecycle
  hook for a deploy. Rejected here as out of scope: it changes the deploy
  trigger for every project at once. Worth doing deliberately later.

## Ignored paths

Deploy is skipped when **every** file changed since the last successful deploy
matches an ignore pattern. Any unrecognized path deploys — the filter can only
ever skip, never force.

Defaults (previously there were none, so a sprint-notes commit triggered a full
build + deploy):

```
sprint/**   docs/**   backlog.md   *.md
```

Patterns use git's `glob` pathspec magic, so `*` stops at `/`: `*.md` is
root-level markdown only, while `docs/**` is recursive.

- `ci.deployIgnorePaths` — **replaces** the defaults.
- `ci.deployIgnorePathsExtra` — **appends** to the defaults.

```jsonc
{
  "ci": {
    "deployIgnorePathsExtra": ["design/**", "*.txt"]
  }
}
```

Note the skip leaves the last-deployed sha where it was, so the next real
deploy still picks up the skipped commits.

A skip prints `⚠ deploy SKIPPED: ...`, naming the base sha, the ignore
patterns applied, and that no deploy will run for this push — never a routine
`→` line, so it can't read as "shipped." `scripts/deploy-detached.sh` reports
the same outcome by reading that line back out of its log rather than
inferring "likely skipped" from a missing deploy record.

**Sprint 292 (2026-08-21 incident):** the filter used to be
`! git diff --name-only "$base"..HEAD -- . "${specs[@]}" | grep -q .`. Piping
into `grep -q` meant `git diff` could be killed by `SIGPIPE` (grep closes the
pipe on its first match, while `git diff` was still writing); under
`set -o pipefail` that read as "only ignored paths changed" and skipped for
real. This broke exactly on **large** diffs — output past the OS pipe buffer
(~16KB on macOS) — so the bigger the push, the more likely it silently didn't
ship. A 34-commit, 662-file push went undeployed for days this way. The fix
captures `git diff`'s output and exit status into separate variables (no
pipe), matching `nx_projects` in `deploy-plan.sh`; a `git diff` failure now
deploys rather than skips. See `scripts/lib/deploy-path-filter.test.sh` for
the regression test.

## Unattended-shell gate

2026-08-19 incident: an emit-social deploy launched from an agent session's
background shell got killed mid-build (`.deploy-status.json` froze at
`deploying` / 66%). See [Signals and interrupted runs](DEPLOY-SIGNALS-AND-LIVENESS.md#signals-and-interrupted-runs)
for what those killed-run status writes look like and how to recover
from one — this gate is the *prevention* half: it stops the deploy from
starting in that kind of shell at all.

**Blocking signal: env markers.** The deploy phase refuses to start (prints
why, exits 1, no status write) when any of `CLAUDECODE`,
`CLAUDE_CODE_ENTRYPOINT`, or `CI` is set in the environment —
`detect_unattended_shell` in `scripts/lib/deploy-plan.sh`, checked against one
clearly-commented marker list (`EMIT_UNATTENDED_SHELL_MARKERS`) so it's easy
to extend as new ephemeral-shell markers are identified.

**Why not detect "no controlling terminal" as the blocking signal instead:**
empirically, inside the exact kind of agent shell that caused the incident,
`-e /dev/tty` is **true** — the device node exists even with no controlling
terminal, so a gate built on it would be a silent no-op. `[ -t 0 ]` is
meaningless here too: git feeds the ref list to every pre-push hook on stdin,
so stdin is never a tty. `has_controlling_terminal` instead actually *opens*
the controlling terminal (`( : < /dev/tty ) 2>/dev/null`), which is the
correct POSIX check — but absence of a controlling terminal is only a
**warning**, not a block, because GUI git clients (VSCode's Source Control
panel, Tower, GitHub Desktop) have no controlling terminal either and
blocking them would break a normal workflow. That warning path prints to
stderr and the deploy proceeds.

**Supported path: the durability declaration.** `EMIT_DEPLOY_DETACHED=1 git
push` bypasses both the block and the warning. It's set automatically by
`scripts/deploy-detached.sh` / the `/deploy` skill — see
[Detached deploys](DEPLOY-SIGNALS-AND-LIVENESS.md#detached-deploys-the-supported-agent-shell-path) —
so you don't write it by hand for the normal case. It's a **declaration the
caller makes, not something this gate can verify**: macOS bash 3.2 exposes no
inherited ignored `SIGHUP`, has no `setsid`, and `nohup` doesn't change
`pgid`, so there's no reliable way to detect "will this process actually
survive" from inside the gate. `EMIT_DEPLOY_DETACHED=1` is a contract — set
it only from a launch mechanism that has actually made the push durable.

This is a separate variable from `EMIT_FORCE_DEPLOY` on purpose —
`EMIT_FORCE_DEPLOY` forces a deploy past the *path* filters (gates 3/4), and
conflating it with "I accept a killable shell" would have silently re-opened
this exact incident for anyone already exporting it for unrelated reasons.

The deprecated `EMIT_ALLOW_UNATTENDED_DEPLOY=1` alias still works — it warns
to stderr and still bypasses the gate, stamped as `unattended-override`
rather than `detached` on the resulting status record so a post-mortem can
tell the two paths apart. Replace it with `EMIT_DEPLOY_DETACHED=1` wherever
you find it; it has no advantage over the new name and will eventually be
removed.

Gate placement in `scripts/hooks/pre-push` is load-bearing: it runs after
every gate that exits 0 (dry-run, ignored-paths) but before `_fail_deploy` is
installed as the `ERR` trap and before `deploy_init` writes the first
in-flight status record. Exiting non-zero after either of those would fire
`deploy_done failed` with the run's start time unset, both writing a status
record this gate promises not to write and throwing a bash arithmetic error.
