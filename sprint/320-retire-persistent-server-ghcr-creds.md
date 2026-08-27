# Retire the persistent GHCR credentials from fleet servers
**Difficulty:** 3

> _Touches every live production server. Gated on sprints **317** and **317.3**
> landing and being proven — without login-per-deploy, removing these
> credentials breaks every blue-green deploy in the fleet, and without an
> ephemeral docker config the next deploy writes the credential straight back._
>
> _Re-gated 2026-08-26: this sprint previously also required 319 (GitHub App
> tokens). It does not. 317 is what makes per-deploy login work; 319 only
> changes **which** token flows through it. 319 is deferred to backlog, so do
> not wait on it — see "Which credential this leaves in place" below._

## Goal
No long-lived GitHub credential sits on any fleet server. Registry auth is
minted at deploy time and expires on its own.

## Reason
Because the blue-green path had no login step, the workaround was a one-time
persistent `docker login` on each server. That wrote base64 of
`develemit:gho_<token>` into `/root/.docker/config.json` on internet-facing
hosts, where it sits indefinitely. The token is the operator's `gh` OAuth
session, whose scopes include `repo` — full read/write to every private
repository on the account. martialops' and diner-decider's servers were both
confirmed to have this file; it is fleet-wide, not project-specific.

Sprints 317 and 317.3 remove the reason for it to exist: 317 adds the
login-per-deploy task to blue-green, and 317.3 makes that login write to an
ephemeral config directory that is cleaned up afterwards, so nothing needs a
credential sitting on disk between deploys. This sprint is the cleanup that makes 317 worth doing — until the old
file is gone, the broad-scope credential is still on disk regardless of what
future deploys use.

### Which credential this leaves in place
With 319 deferred, the token that flows at deploy time is still the operator's
`gh` OAuth session (`ghcr_token`, set by `scripts/hooks/pre-push:191` from
`gh auth token`, passed through `deploy.ts:172`). It is still broad-scope. What
changes is its **lifetime and location**: transient and in-process under
`no_log: true`, instead of at rest in `/root/.docker/config.json` on six
internet-facing hosts. That is the bulk of the exposure removed with no new
credential and no browser step. Narrowing the scope to `packages: read` with a
one-hour expiry is the remaining increment, and it lives in backlog as the
GitHub App item.

## Context

### Hard prerequisites — verify, do not assume
Before touching any server, confirm on that server's project:
1. Sprint 317's login task exists in `deploy-blue-green.yml` and has been
   observed running in a real deploy.
2. That project has completed **at least one successful deploy** using the
   per-deploy login.

If either is unproven for a given project, skip that project and say so. A
project whose last successful deploy predates 317 has never demonstrated it can
pull without the persistent file.

### The safe order per server
Do **not** batch this across the fleet. Per server:
1. Back up `/root/.docker/config.json` to a timestamped path on the server.
2. `docker logout ghcr.io`.
3. Run a real deploy for that project.
4. Confirm the pulls succeed via the per-deploy login.
5. Only then remove the backup — or leave it and note the path.

If step 3 fails, restore the backup immediately and stop the whole sprint.
This is the established pattern in this repo for production credential work:
see the 2026-07-24 develemail `INBOUND_SECRET` and diner-decider R2 remediations,
both of which kept `.bak-<date>` copies on the server and verified before
cleanup.

### Which servers
Derive the list from the fleet configs rather than hardcoding it — every
project with a `serverIp` in `.emit-infra.json`. As of 2026-08-26 that is
develemail, diner-decider, emit-billing, emit-vision, martialops, and tastease;
emit-social has no `serverIp` and needs checking separately. Confirm the
current list at execution time; do not trust this paragraph.

Note that some servers host more than one thing — `emit-infra status` and the
inventory validation from sprint 315 are the tools for confirming which host
you are actually on before running anything destructive.

### Verifying the file is gone and stays gone
`docker logout ghcr.io` rewrites `config.json` rather than deleting it; check
that the `ghcr.io` auth entry specifically is absent, not that the file is
missing.

**Corrected 2026-08-27 (caught in review by martialops).** An earlier version of
this section said a subsequent deploy would re-add a *short-lived* entry that
was "expected and correct". That was wrong. Sprint 317's login task is a plain
`docker login ghcr.io` with no `--config` override and no logout, so the next
deploy rewrites the same broad-scope `gho_` token back into
`/root/.docker/config.json` permanently — making this sprint a one-time cleanup
that undoes itself. Sprint **317.3** fixes that by logging in to an ephemeral
config directory removed after each deploy.

So the correct expectation, once 317.3 has landed: after a deploy, there should
be **no** `ghcr.io` entry in `/root/.docker/config.json` at all. If one appears,
that is a regression in 317.3, not normal behaviour — do not wave it through.

### Do not print credentials
Compare by hash or by key presence. Never echo the auth blob, and keep it out
of any log this repo captures (`.deploy-logs/`).

## Tasks
1. Build the server list from fleet configs; record it.
2. For each, verify the two prerequisites above; skip and record any project
   that fails them.
3. Per server, in order: back up, `docker logout ghcr.io`, deploy, verify
   pulls succeeded, record the outcome.
4. On any failure, restore that server's backup and halt the sprint.
5. Confirm on each completed server that **no** `ghcr.io` auth entry remains
   after a deploy. With 317.3 landed there should be none at all; an entry
   reappearing means 317.3 regressed — halt rather than accepting it.
6. Check `emit-social` separately, since it has no `serverIp`.
7. Write a short runbook documenting the per-server procedure, the rollback,
   and the expectation that no `ghcr.io` entry exists after a deploy — plus
   what to do if one reappears (a 317.3 regression, not a normal state).
8. Update the findings doc's status in
   `~/projects/martialops/docs/ops/emit-infra-upstream-findings.md` — or file a
   note for martialops — recording that Priority 1 is closed, so its sprint 114
   PAT stopgap can be retired.

## Files involved
- No emit-infra source changes expected — this is a fleet operation
- new file: a runbook under `docs/` describing the procedure and rollback
- `~/projects/martialops/docs/ops/emit-infra-upstream-findings.md` — status
  note (or a filed follow-up if editing another repo's doc is undesirable)

## Acceptance criteria
- [x] The server list is derived at execution time and recorded, including
      emit-social's disposition.
- [x] Every server processed had both prerequisites verified first; any skipped
      project is named with the reason.
- [ ] Each server has a timestamped backup taken **before** logout, with paths
      recorded.
- [ ] Each processed server completed a successful real deploy **after**
      logout, with pulls succeeding — paste evidence per server.
- [ ] No long-lived `ghcr.io` auth entry remains on any processed server.
- [x] No credential value appears in any output, log, or `.deploy-logs/` —
      show the grep.
- [x] The runbook documents procedure, rollback, and the expectation of no
      post-deploy `ghcr.io` entry, including what a reappearance means.
- [ ] martialops is informed that the Priority 1 finding is closed.
      (Informed, but accurately reported as **still open** — see Progress
      below. Closure requires at least one server to actually complete the
      migration.)

## Out of scope
- Any code change to emit-infra — 317 and 317.3 own those.
- Servers whose project has not proven a post-317 deploy. Skip and report.
- Rotating or revoking the old `gh` OAuth token itself. Worth doing given it
  sat on internet-facing hosts, but it is the operator's personal account
  credential and that decision is theirs — file it as a recommendation.

## Progress (2026-08-27)

### Done so far
- Derived the server list at execution time from `~/projects/*/.emit-infra.json`
  (`serverIp` field): develemail (178.105.171.1), diner-decider
  (167.233.43.96), emit-billing (167.233.158.240), emit-vision
  (46.225.249.8), martialops (178.105.239.144), tastease (178.104.195.59).
- Checked emit-social separately (no `serverIp` in `.emit-infra.json` as
  expected) — found its server IP in `.env.prod`'s `SERVER_IP`
  (167.233.169.206) and confirmed it's live and reachable via
  `emit-infra status` (containers healthy, uptime 44 days). All 7 projects
  use `blueGreen` deploys, so all 7 are in scope once eligible.
- Verified prerequisite 1 (login task exists in `deploy-blue-green.yml`) for
  all 7: true fleet-wide since it's emit-infra's own shared Ansible role
  (`ansible/roles/app-deploy/tasks/deploy-blue-green.yml:28-63`), landed in
  317 (commit `7c941cc`, 2026-08-26T23:53:20-07:00) and made ephemeral by
  317.3 (commit `a1c8a18`, 2026-08-27T00:39:42-07:00 =
  2026-08-27T07:39:42Z).
- Verified prerequisite 2 (a successful deploy using the per-deploy login,
  i.e. timestamped after 317.3) for all 7 via each project's
  `.deploy-status.json`: **every one predates 317.3** — the latest
  successful deploy across the fleet was tastease at 2026-08-27T05:24:58Z,
  over 2 hours before 317.3 landed; diner-decider's most recent attempt
  (07:38:06Z) was also before 317.3 and failed regardless. **All 7 servers
  were skipped** per the sprint's own gating rule — none has demonstrated it
  can pull without the persistent file since the ephemeral fix landed.
- Wrote the runbook: `docs/GHCR-CREDENTIAL-RETIREMENT.md` — background,
  current fleet-readiness snapshot, prerequisites, per-server procedure,
  rollback, and the "no `ghcr.io` entry should reappear post-317.3" check
  including what a reappearance means (317.3 regression).
- Filed an accurate status note in
  `~/projects/martialops/docs/ops/emit-infra-upstream-findings.md` (Priority
  1 section) — reports that gaps 1 and the ephemeral-config follow-up have
  landed but the migration itself has not run on any server, so the item
  stays **open**, not closed. Did not claim closure since it isn't true yet.
- No credential values were printed, logged, or written anywhere this pass
  (no server was touched) — confirmed via grep on both new/edited docs; the
  only `gho_...` strings present are the pre-existing placeholder pattern
  `gho_<token>`, not real values.

### Blocked on
- Every fleet server is blocked on the same thing: a real, successful
  production deploy for that project timestamped after 317.3 landed
  (2026-08-27T07:39:42Z). Sprint 320 cannot manufacture that deploy itself —
  it has to happen through each project's normal deploy flow — and running
  `docker logout` / server work ahead of that proof would be exactly the
  premature migration the sprint's prerequisite section exists to prevent.
- Separately: the server-touching tasks in this sprint (backup, logout,
  deploy, verify) are irreversible/outward-facing production actions. Per
  this skill's headless-session rules, those aren't something to do without
  the prerequisite proof in hand regardless — so even once a project clears
  prerequisite 2, that project's server work should be confirmed rather than
  batched through unattended.

### Pickup notes
- Re-run this sprint (or just the per-server loop) once any project shows a
  `.deploy-status.json` with `"status": "deployed"` and `finishedAt` after
  `2026-08-27T07:39:42Z`. Check all 7 — don't assume the rest are still
  behind just because one caught up.
- The runbook at `docs/GHCR-CREDENTIAL-RETIREMENT.md` has the exact
  per-server procedure ready to execute; it doesn't need to be rewritten,
  just followed once a project qualifies.
- The martialops findings doc status note should be flipped from "open" to
  "closed" once the migration actually completes on all 7 servers — leave
  that edit for whichever sprint run finishes the job.

## Blocked (2026-08-27, re-check)

**Re-verified prerequisite 2 against current `.deploy-status.json` for all 7
fleet servers (checked at 2026-08-27T13:12:30Z):**

| project | last completedAt | status | vs 317.3 (07:39:42Z) |
|---|---|---|---|
| develemail | 2026-08-26T05:33:29Z | deployed | before — skip |
| diner-decider | 2026-08-27T07:38:06Z | **failed** | before — skip |
| emit-billing | 2026-08-13T19:10:53Z | deployed | before — skip |
| emit-vision | 2026-08-26T04:48:53Z | deployed | before — skip |
| martialops | **2026-08-27T13:11:29Z** | **deployed** | **after — qualifies** |
| tastease | 2026-08-27T05:24:58Z | deployed | before — skip |
| emit-social | 2026-08-27T04:46:38Z | deployed | before — skip |

martialops now has a real successful deploy after 317.3 landed — the first
project in the fleet to clear prerequisite 2. It is ready for the per-server
migration (backup → `docker logout ghcr.io` → deploy → verify pulls →
confirm no `ghcr.io` entry remains), following the runbook at
`docs/GHCR-CREDENTIAL-RETIREMENT.md`.

**Not executed this run.** The migration touches a live, internet-facing
production server: it logs out the credential the server currently relies on
to pull images, then depends on a real redeploy succeeding to restore pull
access. That is exactly the class of irreversible/outward-facing production
action this skill's headless-session rules require a halt for rather than
unattended execution — clearing the automated prerequisite gate is necessary
but was already flagged in the prior pass as not sufficient on its own. No
backup, logout, or deploy was run against martialops or any other server this
pass; nothing was touched.

### What's needed to unblock
Explicit go-ahead to run the martialops per-server procedure from
`docs/GHCR-CREDENTIAL-RETIREMENT.md` (backup `/root/.docker/config.json`,
`docker logout ghcr.io`, redeploy, verify pulls and absence of a `ghcr.io`
entry). Once approved and run, re-check the other 6 servers' deploy statuses
before declaring the sprint complete — six of seven are still pre-317.3 and
will need their own qualifying deploys first.

## Blocked (2026-08-27T16:54:27Z, re-check)

**Re-verified prerequisite 2 against current `.deploy-status.json` for all 7
fleet servers.** The fleet has moved on substantially since the last check
(13:12:30Z) — six of seven projects have deployed again since then:

| project | last completedAt | status | vs 317.3 (07:39:42Z) |
|---|---|---|---|
| develemail | 2026-08-27T15:10:41Z | deployed | **after — qualifies** |
| diner-decider | 2026-08-27T07:38:06Z | **failed** | before — skip (unchanged) |
| emit-billing | 2026-08-27T15:07:28Z | deployed | **after — qualifies** |
| emit-vision | 2026-08-27T15:15:43Z | deployed | **after — qualifies** |
| martialops | 2026-08-27T13:11:29Z | deployed | after — qualifies (unchanged) |
| tastease | 2026-08-27T15:13:56Z | deployed | **after — qualifies** |
| emit-social | 2026-08-27T15:12:15Z | deployed | **after — qualifies** |

Six of seven fleet servers now clear prerequisite 2 (only diner-decider is
still stuck on its pre-317.3 failed deploy — a separate, unrelated deploy
failure, out of scope for this sprint to fix). All six are ready for the
per-server migration in `docs/GHCR-CREDENTIAL-RETIREMENT.md`.

**Still not executed.** Clearing the prerequisite gate for six servers does
not change the nature of the remaining work: backing up and logging out a
live production server's registry credential, then depending on a real
redeploy to restore pull access, is an irreversible/outward-facing production
action. Per this skill's headless-session rules, that requires an explicit
go-ahead rather than unattended execution, regardless of how many servers are
technically eligible. No backup, logout, or deploy was run against any server
this pass; nothing was touched.

### What's needed to unblock
Explicit go-ahead to run the per-server procedure from
`docs/GHCR-CREDENTIAL-RETIREMENT.md` against the six qualifying servers
(develemail, emit-billing, emit-vision, martialops, tastease, emit-social).
diner-decider stays skipped until it has its own successful post-317.3
deploy. Once approved and run for all six, re-check diner-decider separately
before declaring the sprint complete.
