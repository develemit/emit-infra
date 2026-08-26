# Retire the persistent GHCR credentials from fleet servers
**Difficulty:** 3

> _Touches every live production server. Gated on sprints 317 and 319 both
> landing and being proven — without login-per-deploy, removing these
> credentials breaks every blue-green deploy in the fleet._

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

Sprints 317 and 319 remove the reason for it to exist: 317 adds the
login-per-deploy task to blue-green, and 319 makes the credential a
`packages: read` token that expires in an hour. This sprint is the cleanup that
makes those worth doing — until the old file is gone, the broad-scope
credential is still on disk regardless of what future deploys use.

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
missing. A subsequent deploy will re-add a *short-lived* entry — that is
expected and correct, and worth stating in the runbook so the next person does
not "fix" it.

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
5. Confirm on each completed server that no long-lived `ghcr.io` auth entry
   remains, and that a post-deploy entry (if present) is the short-lived one.
6. Check `emit-social` separately, since it has no `serverIp`.
7. Write a short runbook documenting the per-server procedure, the rollback,
   and the note that a post-deploy short-lived entry is expected.
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
- [ ] The server list is derived at execution time and recorded, including
      emit-social's disposition.
- [ ] Every server processed had both prerequisites verified first; any skipped
      project is named with the reason.
- [ ] Each server has a timestamped backup taken **before** logout, with paths
      recorded.
- [ ] Each processed server completed a successful real deploy **after**
      logout, with pulls succeeding — paste evidence per server.
- [ ] No long-lived `ghcr.io` auth entry remains on any processed server.
- [ ] No credential value appears in any output, log, or `.deploy-logs/` —
      show the grep.
- [ ] The runbook documents procedure, rollback, and the expected post-deploy
      short-lived entry.
- [ ] martialops is informed that the Priority 1 finding is closed.

## Out of scope
- Any code change to emit-infra — 317 and 319 own those.
- Servers whose project has not proven a post-317 deploy. Skip and report.
- Rotating or revoking the old `gh` OAuth token itself. Worth doing given it
  sat on internet-facing hosts, but it is the operator's personal account
  credential and that decision is theirs — file it as a recommendation.
