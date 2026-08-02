# Clean emit-vision's deploy path: env drift, guardrail, dms-ping retirement
**Difficulty:** 3

## Goal
A routine `emit-infra deploy emit-vision` completes cleanly end-to-end: no
env-removal guardrail trip, no secrets-drift warnings, and no revived
`dms-ping` crash-loop. emit-vision becomes the healthy deploy it currently
only appears to be.

## Reason
emit-vision is the only fleet project whose deploy path is actively broken,
discovered during sprint 261: a full deploy is blocked by the sprint-241
env-removal guardrail (two stale server keys), the secrets-drift route reports
real drift in both directions, and the next deploy will re-create the
`dms-ping` container — which now crash-loops by design (sprint 261's
fail-loud guard) because the user deferred healthchecks.io indefinitely on
2026-08-01 in favor of a future self-hosted approach (backlog, tagged
`[discovery]`). Left alone, all of this ambushes whoever ships the next
emit-vision feature. Clearing it deliberately is cheap; hitting it mid-feature
is not.

## Context
Recorded state from sprint 261 (2026-08-01) — **re-verify everything live
before acting**:

- **Guardrail trip:** `emit-infra deploy emit-vision` was blocked by
  `enforceEnvRemovalGuard` (`apps/cli/src/commands/deploy.ts`, sprint 241) on
  two server-side keys absent from the local envFile:
  `NEXT_PUBLIC_EMIT_VISION_DOGFOOD_KEY` and `NEXT_PUBLIC_EMIT_VISION_PROJECT_ID`
  — leftovers from emit-vision's dogfood-instrumentation removal (its sprints
  441/442). The guardrail is doing its job; the fix is a deliberate,
  documented removal via `--allow-env-removal` after confirming nothing on
  the server still reads those keys.
- **Drift report** (`GET /projects/emit-vision/secrets-drift` on the local
  API, port 7001): `missing`: `INTERNAL_API_SECRET`, `OPERATOR_API_KEY`,
  `WAITLIST_ADMIN_KEY`, `HEALTHCHECKS_URL`; `extra`: the two stale
  `NEXT_PUBLIC_*` keys plus `BUILD_NUMBER`. Read the drift route's semantics
  in the API source before acting (sprint 239 built empty-value detection) —
  "missing" vs "extra" refer to specific sides of the envFile/server/
  `requiredEnvKeys` comparison; do not guess which. `BUILD_NUMBER` is written
  into the server env by the deploy itself (`Set BUILD_NUMBER in server .env`
  task in `ansible/roles/app-deploy/tasks/main.yml`) — if the drift route
  flags it, that is a false positive worth either allowlisting or noting,
  not "fixing" on the server.
- **envFile is the deploy source of truth** (project memory):
  `emit-vision/infra/secrets.prod.env`. Any key reconciliation happens there
  first; on-server-only edits regress on the next deploy. The three `missing`
  secrets need real values sourced/generated per whatever emit-vision's docs
  say they're for — if a value can't be determined safely, say so in the
  completion notes rather than inventing one.
- **dms-ping retirement (user decision, 2026-08-01):** the container is
  currently `Exited (1)` — manually stopped on the server after the user
  deferred healthchecks.io. The service definition still lives in
  `emit-vision/infra/docker/docker-compose.infra.yml`, so the next deploy
  revives the crash loop. Retire it: remove the `dms-ping` service from that
  compose file, remove `HEALTHCHECKS_URL` from emit-vision's
  `requiredEnvKeys` (`.emit-infra.json`) and its blank
  `HEALTHCHECKS_URL=`+TODO line from `infra/secrets.prod.env` (otherwise the
  drift route reports it forever). Keep sprint 261's fail-loud pattern note in
  the compose file history via the commit message, not a dead service block.
- **provision-list falsehood:** `provision-list/healthchecks-io.md` (in
  emit-vision) claims `Status: ✅ Complete` / "Verified running in
  production" — false (sprint 261 proved it never pinged anything). Rewrite it
  to state: deferred by user decision 2026-08-01, superseded by the
  `[discovery]` self-hosted DMS backlog item in emit-infra.
- Deploy mechanics: SSH as `root@<serverIp>` with `~/.ssh/emit-vision-deploy`;
  app dir `/opt/emit-vision`. The CLI dist pitfall applies if any
  `apps/cli`/`packages/core` source changes: rebuild `apps/cli/dist` before
  any real deploy.
- The local API's monitor HTTP-probes `https://api.emitvision.com/healthz`
  every 60s — after each server-touching step, confirm no down-transition
  push fired (i.e., don't break prod while cleaning it).

## Tasks
1. Re-verify current state live: run the drift route, read its source to pin
   down `missing`/`extra` semantics, list the server's actual `.env` keys
   (names only — never print secret values; compare by SHA-256 hash like
   sprint 257 did), and `docker ps -a` for `dms-ping`'s current state.
2. Grep the emit-vision codebase and server compose files for any remaining
   reader of the two stale `NEXT_PUBLIC_*` keys; record the (expected
   negative) result.
3. Reconcile `infra/secrets.prod.env`: add/populate the missing keys with
   correct real values (or document precisely why a key is intentionally
   absent and remove it from `requiredEnvKeys` instead); remove the
   `HEALTHCHECKS_URL` line.
4. Retire `dms-ping` from `infra/docker/docker-compose.infra.yml` and
   `HEALTHCHECKS_URL` from `requiredEnvKeys`.
5. Rewrite `provision-list/healthchecks-io.md` honestly (deferred, superseded
   by discovery item).
6. Commit emit-vision changes in the emit-vision repo.
7. Deploy: one `emit-infra deploy emit-vision` with `--allow-env-removal`,
   watching the printed removal list — it must contain exactly the two stale
   `NEXT_PUBLIC_*` keys and nothing else; abort if anything else appears.
8. Verify end state: deploy `deployed`; `dms-ping` absent from
   `docker ps -a`; drift route clean (or reduced to documented, justified
   entries); `https://api.emitvision.com/healthz` still 200; a `phases`
   entry in emit-vision's `.deploy-history.jsonl`.
9. Prove the steady state: a second, plain `emit-infra deploy emit-vision`
   (no flags) completes with no guardrail prompt and no drift warnings.

## Files involved
- `~/projects/emit-vision/infra/secrets.prod.env` — key reconciliation
- `~/projects/emit-vision/infra/docker/docker-compose.infra.yml` — remove
  `dms-ping` service
- `~/projects/emit-vision/.emit-infra.json` — drop `HEALTHCHECKS_URL` from
  `requiredEnvKeys`
- `~/projects/emit-vision/provision-list/healthchecks-io.md` — honest rewrite
- emit-infra: read-only reference (`deploy.ts` guardrail, secrets-drift route,
  app-deploy role) — code changes only if a real defect is found, with tests

## Acceptance criteria
- [x] Plain `emit-infra deploy emit-vision` (task 9) completes clean: no
      guardrail trip, no `--allow-env-removal`, status `deployed`
- [x] Secrets-drift route for emit-vision is clean, or every remaining entry
      is explained in the completion notes with why it's correct
- [x] The `--allow-env-removal` deploy removed exactly the two stale
      `NEXT_PUBLIC_*` keys (removal list quoted in completion notes)
- [x] `dms-ping` no longer exists on the server after deploy, and nothing in
      the repo re-creates it
- [x] `provision-list/healthchecks-io.md` no longer claims completion
- [ ] No secret values printed anywhere in logs/notes (hash comparisons only)
      — **NOT MET, see Security note in Completed section below.**
- [x] emit-vision stayed healthy throughout (healthz 200; no down-transition
      alerts from the local monitor)
- [x] Test coverage: emit-infra suites (`pnpm test:hooks`, nx run-many
      typecheck/lint/test) still green; if any emit-infra source changed,
      the change carries a test in its colocated `*.test.ts`

## Out of scope
- Building the self-hosted DMS replacement (backlog `[discovery]` item —
  explicitly parked by the user)
- tastease's `uptime-ping` (sprint 264)
- Any emit-vision feature/app work beyond the deploy path
- Fixing other projects' drift (this sprint is emit-vision only)

## Completed

**Date:** 2026-08-01

### Summary
Re-verified sprint 261's recorded state live and it matched exactly: the
guardrail was tripping on two stale `NEXT_PUBLIC_EMIT_VISION_*` keys with no
remaining code readers, the drift route reported the three real secrets as
"missing" (present locally with real values, just never synced to the server
because no deploy had run since they were added to `secrets.prod.env`), and
`dms-ping` sat `Exited (1)` on the server.

Retired `dms-ping` from `infra/docker/docker-compose.infra.yml`, dropped
`HEALTHCHECKS_URL` from `requiredEnvKeys` and `secrets.prod.env`, and rewrote
`provision-list/healthchecks-io.md` to state the honest history (never
verified running; deferred 2026-08-01; superseded by the self-hosted DMS
`[discovery]` backlog item from sprint 261) rather than a false "✅ Complete."
Committed in emit-vision (not pushed — nothing in this sprint required CI/a
GitHub push; ansible reads the compose/env files directly from the local
working tree).

Ran `emit-infra deploy --allow-env-removal`: the printed removal list was
exactly `NEXT_PUBLIC_EMIT_VISION_DOGFOOD_KEY` and
`NEXT_PUBLIC_EMIT_VISION_PROJECT_ID` — nothing else — matching the sprint's
named keys. Deploy succeeded (blue→green switch, both `web`/`api` healthy).

Two real defects turned up during verification and were fixed (in scope per
"code changes only if a real defect is found, with tests"):
1. **Orphaned containers survive deploy.** `docker compose up -d` (no
   `--remove-orphans`) doesn't remove containers whose service was deleted
   from the compose file — `dms-ping` was still sitting there, stopped, after
   the first deploy. Added `--remove-orphans` to the "Start infra stack" task
   in `ansible/roles/app-deploy/tasks/main.yml`, and removed the leftover
   container manually on the server to confirm the fix works. No colocated
   `*.test.ts` — this is an Ansible YAML task, not TS source; verified instead
   by re-running the deploy and confirming the orphan didn't come back and no
   new one was created.
2. **`S3_BUCKET` was undeclared.** After the first deploy synced the full
   local envFile, the drift route flagged `S3_BUCKET` as an unexplained
   "extra" server key. It's genuinely required —
   `infra/docker/docker-compose.app.yml`, `apps/api/src/lib/s3-upload.ts`,
   and `apps/worker/src/lib/s3-upload.ts` all read it directly — it had just
   never been added to `requiredEnvKeys`. Added it (additive only, no value
   change).

After both fixes, the drift route returned `status: "ok"`, `missing: []`,
`extra: []`. A second, plain `emit-infra deploy emit-vision` (no flags)
completed with no guardrail prompt, `38 keys → server (38 keys)`, and
`Deployed successfully.`

**Security note (criterion not met):** early in this sprint, a shell command
intended to redact secret values before printing them (`sed -E
's/=(.+)$/=<REDACTED len=\1>/'`) had a bug — it captured the value into `\1`
and printed it back out, instead of its length. This put the real values of
`INTERNAL_API_SECRET`, `OPERATOR_API_KEY`, `WAITLIST_ADMIN_KEY`, and the
(non-sensitive) `S3_BUCKET` bucket name into this session's tool-call
transcript. No secret value was written into any repo file, commit, or the
sprint file itself — every comparison after that point used SHA-256 hashes
only, per the sprint's instruction. But the transcript exposure itself is
real and the acceptance criterion is honestly unmet. **Recommend rotating
`INTERNAL_API_SECRET`, `OPERATOR_API_KEY`, and `WAITLIST_ADMIN_KEY`** and
redeploying with the new values.

### Files changed
emit-vision (commits `deca6e2`, `539f387`):
- `infra/docker/docker-compose.infra.yml` — removed `dms-ping` service
- `.emit-infra.json` — dropped `HEALTHCHECKS_URL`, added `S3_BUCKET` to
  `requiredEnvKeys`
- `provision-list/healthchecks-io.md` — honest rewrite (deferred, superseded)
- `infra/secrets.prod.env` (gitignored, not committed) — removed the blank
  `HEALTHCHECKS_URL=` line

emit-infra (commit `45512cf`):
- `ansible/roles/app-deploy/tasks/main.yml` — added `--remove-orphans` to the
  infra-stack start task

### Verification
- `emit-infra deploy --allow-env-removal`: removal list = exactly the two
  named `NEXT_PUBLIC_*` keys; deploy succeeded (blue→green, healthy)
- `emit-infra deploy` (plain, second run): no guardrail, no drift, `Deployed
  successfully.` (blue→green→blue not required; went green, both slots
  healthy)
- Drift route (`GET /projects/emit-vision/secrets-drift`): `status: "ok"`,
  `missing: []`, `extra: []`
- `docker ps -a` on the server: no `dms-ping` container (removed manually
  after the `--remove-orphans` fix; confirmed absent after the second deploy
  too)
- `https://api.emitvision.com/healthz`: 200 throughout; `.incidents.jsonl`
  shows one down/up pair at 2026-08-01 11:22–11:23 UTC, well before this
  sprint's work started (03:27 UTC 2026-08-02) — unrelated, no incident
  caused by this sprint
- `pnpm test:hooks`: 36/36 pass
- `npx nx run-many -t typecheck lint test`: all green (207 dashboard/api
  tests pass, typecheck/lint clean across cli/api/dashboard)
- Grep for readers of the two stale `NEXT_PUBLIC_*` keys in emit-vision: none
  found

### Follow-ups
- `[blocker]` Rotate `INTERNAL_API_SECRET`, `OPERATOR_API_KEY`, and
  `WAITLIST_ADMIN_KEY` for emit-vision — their real values were accidentally
  printed into this session's transcript by a broken redaction command (see
  Security note above). Update `secrets.prod.env` and redeploy after
  rotating.
- `[defer]` `provision-list/summary.md` line 30 still shows `healthchecks.io
  (DMS) | ✅ Complete | — dms-ping live` — now directly contradicted by the
  rewritten `healthchecks-io.md`. Out of this sprint's declared file scope;
  worth a one-line fix next time that file is touched.
- `[defer]` `.deploy-history.jsonl` `phases` entries (task 8) are only
  written by the CI/webhook deploy path (`scripts/lib/ci-utils.sh`), not by a
  direct `emit-infra deploy` CLI run — the two CLI deploys in this sprint
  correctly show up as immediate console success but don't add a
  `.deploy-history.jsonl` line. Not a defect, just a mismatch between task
  8's expectation and how the CLI path actually works; worth noting if a
  future sprint wants CLI-triggered deploys to also log history.
