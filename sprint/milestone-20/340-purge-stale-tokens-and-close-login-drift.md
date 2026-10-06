# Purge stale tokens from deploy logs and close the standard-deploy login drift
**Difficulty:** 2

## Goal
No GitHub token text remains in any project's deploy or CI logs, a check stops
them reappearing, and the standard-deploy path uses the same ephemeral Docker
login the blue-green path already does.

## Reason
Eight log files across develemail, diner-decider, emit-billing, emit-social and
martialops still contain `gho_` GitHub tokens. The leak source was fixed on
2026-08-27 (sprint 317.3) and every one of these files predates that fix
(newest 2026-08-26), so this is residue, not an ongoing leak — but credential
text on disk stays dangerous for as long as it sits there, and nothing today
would notice if a future change started writing tokens again.

Verified 2026-09-17, which bounds the urgency: none of these files is tracked by
git and none appears in git history (martialops has two tracked log files, both
token-free), the containing directories are gitignored in every project, and
none of the tokens matches the current `gh` token. They are older tokens from
before the 2026-09-13 token refresh.

Separately, `ansible/roles/app-deploy/tasks/deploy-standard.yml:26` still runs
`docker login ghcr.io` with no `--config` and no cleanup, leaving persistent
credentials in the default Docker config on the server. The blue-green path was
fixed to use an ephemeral config directory
(`deploy-blue-green.yml:45-56`) and standard was left behind. Only the
`test-smoke` fixture uses standard deploy today, so this is dormant rather than
urgent — but it is the kind of drift that stops being dormant the moment a real
project uses that path.

## Context

### The files
Find them with, from `~/projects`:
```
grep -rlE 'gho_[A-Za-z0-9]{20,}' */.deploy-logs */.ci-logs
```
Treat the contents as live credentials while handling them: don't echo a token
into a terminal, a commit message, or a sprint file. Counting and hashing are
fine; printing is not.

### What "purge" should mean
Deleting the files is simplest and they are disposable build logs. Scrubbing
the token text in place preserves the log for debugging. Either is defensible —
pick one, apply it consistently, and say which. There is no git history to
rewrite, which is what makes this cheap.

### Preventing recurrence
The capture path writes these logs (`scripts/lib/ci-log-capture.sh` and the
`.deploy-logs`/`.ci-logs` writers). A cheap guard is a scan that fails loudly
when a token pattern appears in a captured log — the same "fail loudly rather
than silently" posture sprint 330.1 applied to the GHCR prune. Prefer a check
that runs where logs are written or in `pnpm test:hooks`, not a background job.

### The Ansible drift
`deploy-blue-green.yml:45-56` is the pattern to copy: log in with
`docker --config "{{ ghcr_config_dir }}"`, export `DOCKER_CONFIG` for the tasks
that need it (each Ansible task is a separate process), and clean up after.
`deploy-standard.yml:26` keeps `no_log: true`, which hides the token from
Ansible output but does nothing about the credential left on disk.

### Stale backlog items to strike, not plan
Two security items in `backlog.md` are already fixed and should be struck with a
pointer to the sprint that fixed them — verified 2026-09-17:
- "`printDryRunPlan` does not redact secrets" — `apps/cli/src/commands/deploy.ts`
  prints `JSON.stringify(redactSecrets(extraVars), null, 2)` (sprint 317.2).
- "runAnsible's thrown error leaks raw `ghcr_token`" — both error paths in
  `packages/core/src/ansible.ts` throw only `ansible-playbook exited with code
  <n>`, with no argv (sprint 317.1).

### Conventions
Shell libs under `scripts/lib/` with sibling `*.test.sh` registered in
`test:hooks`. No `check:affected` here; the suite is `pnpm test:hooks` plus
`pnpm test`, `pnpm typecheck`, `pnpm lint`.

## Tasks
1. Purge the token text from all eight files (delete or scrub — state which),
   then re-run the scan and show zero matches fleet-wide.
2. Add a guard that fails when a captured log contains a token pattern, with a
   test using a fixture containing a fake token — never a real one.
3. Bring `deploy-standard.yml` in line with `deploy-blue-green.yml`: ephemeral
   Docker config directory, `DOCKER_CONFIG` where needed, cleanup afterwards.
4. Verify the standard path still works against the `test-smoke` fixture, or
   state plainly that it can't be exercised and why.
5. Strike the two stale backlog items above, annotating each with the sprint
   that actually fixed it.

## Files involved
- `~/projects/*/.deploy-logs/`, `~/projects/*/.ci-logs/` — purge token text
- `ansible/roles/app-deploy/tasks/deploy-standard.yml` — ephemeral login + cleanup
- new file: `scripts/lib/log-secret-scan.test.sh` (or equivalent) — fixture-based guard
- `package.json` — register any new test in `test:hooks`
- `backlog.md` — strike the two stale items

## Acceptance criteria
- [x] A fleet-wide scan of `.deploy-logs`/`.ci-logs` finds zero token matches —
      quote the count before and after, never a token
- [x] No token value appears in any commit message, sprint file or test fixture
      produced by this sprint
- [x] The new guard fails on a fixture log containing a fake token and passes on
      a clean one, covered by a registered test
- [x] `deploy-standard.yml` uses an ephemeral Docker config and cleans up, with
      no persistent `docker login` left behind
- [x] The two stale backlog items are struck with the fixing sprint noted
- [x] `pnpm test:hooks` passes

## Out of scope
- Revoking or rotating the older GitHub tokens — that's a human action on
  GitHub; flag it in the report instead.
- The `[someday]` GitHub App token item, which is an explicit user decision.
- Rewriting git history — nothing is committed, so none is needed.

## Completed

**Date:** 2026-09-18

### Summary
Purged the eight leftover `gho_`-token log files (fleet-wide scan: 8 files
before → 0 after) and added a guard so a captured log can't hold a token
again undetected. The two files the original backlog item also counted from
`emit-vision` had already aged out through `_emit_rotate_logs`'s normal
100-log cap before this sprint started — the fleet's real residue was 8
files across 5 projects (develemail, diner-decider, emit-billing,
emit-social, martialops), not 10 across 6. Deleted rather than scrubbed:
these are disposable build logs, none is tracked by git or gitignored-out of
history, so deletion is strictly simpler and loses nothing worth keeping.

The guard is `scripts/lib/log-secret-scan.sh` (`emit_scan_log_for_secrets`),
matching `gh[oprsu]_` and `github_pat_` token shapes. It's wired into
`ci_done`/`deploy_done` in `ci-utils.sh`, run right after `_emit_flush_log`
against the just-finished `.ci-logs`/`.deploy-logs` file. Both call sites run
under `set -euo pipefail` in `scripts/hooks/pre-push`, and both functions
return the scan's exit code as their own — so a token reappearing in a
captured log now fails the hook loudly (via the existing `ERR` trap) instead
of sitting on disk silently, mirroring the fail-loudly posture sprint 330.1
applied to GHCR prune.

`deploy-standard.yml` now uses the same ephemeral-login shape as
`deploy-blue-green.yml`: a per-deploy `/root/.docker-ghcr-<project>` config
dir, `DOCKER_CONFIG` scoped only to the `pull` task (each Ansible task is a
separate process, so this can't live on the login task), and `always`-block
cleanup so a failed pull still removes the credential. `ansible-playbook
--syntax-check` passes. A live exercise against the `test-smoke` fixture
(the only project on the standard path) wasn't possible — its
`.emit-infra.json` domain is `192.0.2.1`, an RFC 5737 documentation address
with no real server behind it — so this was verified by syntax-check plus
mirroring blue-green's already-battle-tested task shape task-for-task,
not by a live run.

Struck four now-resolved backlog items, not the two named in the sprint's
own context section: the two it named (`printDryRunPlan` secret redaction,
317.2; the related `runAnsible` argv leak, 317.1 — the latter was never its
own backlog line, only referenced inline inside the former's text) plus two
more from sprint 317.3 that this sprint's own tasks 1 and 3 directly
resolved (the token-residue item, and the `deploy-standard.yml` drift item).
Leaving those two accurate-when-filed-but-now-stale entries unstruck would
have left backlog.md contradicting work done in this same sprint.

### Files changed
- `scripts/lib/ci-utils.sh` — sources `log-secret-scan.sh`; `ci_done`/
  `deploy_done` scan the finished log and propagate a failure
- `ansible/roles/app-deploy/tasks/deploy-standard.yml` — ephemeral GHCR
  docker config dir + `DOCKER_CONFIG`-scoped pull + `always`-block cleanup,
  replacing the bare persistent `docker login`
- `backlog.md` — struck 4 resolved items (see Summary) with the fixing
  sprint noted on each
- `package.json` — registered `log-secret-scan.test.sh` in `test:hooks`
- (new) `scripts/lib/log-secret-scan.sh` — `emit_scan_log_for_secrets <file>`,
  fails loudly on a GitHub token pattern
- (new) `scripts/lib/log-secret-scan.test.sh` — 5 cases: clean log, `gho_`
  token, `github_pat_` token, error text never echoes the fake token, and a
  missing file
- Deleted (outside this repo, all untracked by git): 2
  `develemail/.deploy-logs/*.log`, 1 `diner-decider/.deploy-logs/*.log`, 1
  `emit-billing/.deploy-logs/*.log`, 2 `emit-social/.deploy-logs/*.log`, 2
  `martialops/.deploy-logs/*.log`

### Verification
- Fleet-wide token scan: 8 files before → 0 after (`grep -rlE
  'gho_[A-Za-z0-9]{20,}' */.deploy-logs */.ci-logs` from `~/projects`)
- `pnpm test:hooks`: all suites pass, including the new 5/5
  `log-secret-scan.test.sh`
- `pnpm test`: 439/439 pass
- `pnpm typecheck`: clean (5 projects)
- `pnpm lint`: clean (5 projects)
- `ansible-playbook --syntax-check playbooks/deploy.yml`: passes
- Confirmed the 8 deleted files were untracked in every source repo
  (`git status --porcelain -- .deploy-logs` empty in each)

### Follow-ups
- `[defer]` Revoke/rotate the older `gho_` tokens that were in the deleted
  logs — verified 2026-09-17 none matches the current `gh` token and none
  appears in git history, so this is cleanup, not an active leak, but it's a
  human action on github.com that nothing here can do.
- `[defer]` The `[someday]` GitHub App token item remains an explicit user
  decision, untouched by this sprint.
