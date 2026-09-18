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
- [ ] A fleet-wide scan of `.deploy-logs`/`.ci-logs` finds zero token matches —
      quote the count before and after, never a token
- [ ] No token value appears in any commit message, sprint file or test fixture
      produced by this sprint
- [ ] The new guard fails on a fixture log containing a fake token and passes on
      a clean one, covered by a registered test
- [ ] `deploy-standard.yml` uses an ephemeral Docker config and cleans up, with
      no persistent `docker login` left behind
- [ ] The two stale backlog items are struck with the fixing sprint noted
- [ ] `pnpm test:hooks` passes

## Out of scope
- Revoking or rotating the older GitHub tokens — that's a human action on
  GitHub; flag it in the report instead.
- The `[someday]` GitHub App token item, which is an explicit user decision.
- Rewriting git history — nothing is committed, so none is needed.
