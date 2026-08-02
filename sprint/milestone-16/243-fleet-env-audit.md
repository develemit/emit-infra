# Declare requiredEnvKeys across the fleet and audit for missing production env
**Difficulty:** 3

## Goal
Every managed project declares `requiredEnvKeys`, so secrets-drift is active fleet-wide instead of dormant. Produce a written audit reporting, per project, which required env is absent or empty on its server — with develemail and emit-social checked first.

## Reason
This is the requesting team's headline acceptance criterion, and it is the payoff for the whole initiative: **6 of 7 projects have never declared `requiredEnvKeys`** (verified 2026-07-24), so the drift check has been silently inert everywhere since it shipped. emit-vision had four missing email vars that nobody noticed for a long period; the reasonable prior is that others have gaps too.

Crucially, this audit **could not have been done earlier**. A local-vs-server key comparison cannot answer "is the server missing env the app needs" — it only proves the two sides agree, not that either is complete. I ran exactly that comparison on 2026-07-24 and all four live projects agreed, which reveals nothing about completeness. Only declared `requiredEnvKeys` make the question answerable, and only sprint 240's scaffold command makes declaring them cheap enough to actually happen. Hence this sprint runs last.

develemail and emit-social are called out first because **both send email** — the same subsystem whose silent failure started this whole thread.

## Context
- **Hard prerequisites.** Sprint 240 must be complete (`emit-infra secrets scaffold-required-keys` exists and is built into `apps/cli/dist`). Sprint 239 should be complete so the drift route reports **empty-valued** keys, not just absent ones — that is half the value of this audit, since `KEY=` is the failure mode compose actually produces. If 239 is not done, note the limitation explicitly in the report rather than silently under-reporting.
- **The fleet.** Seven projects under `~/projects/*/.emit-infra.json`. Verified state as of 2026-07-24:
  - `emit-vision` — **has** `requiredEnvKeys` (36 keys, hand-authored by its team post-incident). **Do not regenerate or overwrite it** — it was deliberately curated. Audit it as-is.
  - `develemail`, `emit-social`, `tastease`, `diner-decider` — live servers, no declared keys. Prime targets.
  - `martialops` — **shelved, no server exists.** Scaffolding will fail (unreachable). Skip it and record why; this is expected, not a defect.
  - `test-smoke` — test fixture, not a real deployment. Skip and note.
- **Scaffold is a starting point, not an oracle.** `scaffold-required-keys` derives the list from what is *currently on the server*, so it declares "what is deployed," which may itself be incomplete — that is exactly how emit-vision's four missing keys hid. So after scaffolding, **review** each list against the project's actual needs: check its `docker-compose.prod.yml` / compose files for `${VAR}` references, and its `.env.example` if one exists. A `${VAR}` referenced by compose but absent from the server `.env` is precisely the silent-empty-string failure and belongs in the report.
- **Reading compose for `${VAR}` references** is the highest-signal completeness check available without app-source analysis: `docker-compose` substitutes an absent `${VAR}` with an empty string, the container starts "healthy," and the app may treat empty as "feature disabled." Grep the project's compose file(s) for `${...}` and compare against the server key set.
- **Report format.** Write `docs/env-audit.md`, following the structure of `docs/nginx-vhost-audit.md` from sprint 234 (that initiative's fleet audit) — a summary table plus a per-project section with findings and recommended remediation. That file is the house precedent for this kind of report; match its shape so the two read as a series.
- **Verification tooling.** The API on `:7001` serves `GET /projects/:name/secrets-drift`. Use it after declaring keys for each project. Also useful: `GET /projects/:name/status` for reachability.
- **Do not remediate production in this sprint.** If the audit finds a project missing env the app needs, **report it** — do not SSH in and add secrets. Remediation touches production, needs per-project judgment about correct values, and belongs in follow-up work the user approves. The one exception: writing `requiredEnvKeys` into local `.emit-infra.json` files is a local config change and is in scope.
- **Full typecheck** — `pnpm typecheck` across all 5 projects, even though this sprint is mostly config + docs, because it edits `.emit-infra.json` files that the zod schema validates.

## Tasks
1. Confirm prerequisites: `scaffold-required-keys` is present in `apps/cli/dist`; note whether sprint 239's empty-value detection is live (it changes what the audit can see).
2. For each of `develemail`, `emit-social`, `tastease`, `diner-decider`: run `emit-infra secrets scaffold-required-keys <project> --dry-run` first, review the proposed list, then write it. Do these two email-senders first: `develemail`, `emit-social`.
3. Leave `emit-vision`'s curated 36-key list untouched. Record that it was intentionally preserved.
4. Skip `martialops` (shelved, no server) and `test-smoke` (test fixture); record both with the reason.
5. For each project with declared keys, grep its compose file(s) for `${VAR}` references and compare against the server's actual key set. Flag any `${VAR}` that compose expects but the server lacks, or that is present-but-empty — these are the silent-failure candidates.
6. Query `GET /projects/<name>/secrets-drift` on `:7001` for every project with declared keys and capture the status plus any `missing` / `empty` lists.
7. Write `docs/env-audit.md` in the style of `docs/nginx-vhost-audit.md`: summary table (project / declared keys / drift status / missing / empty / verdict) plus per-project findings and recommended remediation, with the email senders analyzed first.
8. Log every genuine gap found as a `backlog.md` item so nothing discovered here evaporates, tagged for follow-up rather than silently fixed.
9. Run `pnpm typecheck`, `pnpm test`, `pnpm lint` across **all 5 projects** (the `.emit-infra.json` edits are schema-validated).
10. Summarize in the completion notes: how many projects now declare keys, how many gaps were found, and which need production remediation.

## Files involved
- `~/projects/develemail/.emit-infra.json`, `~/projects/emit-social/.emit-infra.json`, `~/projects/tastease/.emit-infra.json`, `~/projects/diner-decider/.emit-infra.json` — add `requiredEnvKeys` (these are **outside this repo**; each is that project's own config file)
- `~/projects/emit-vision/.emit-infra.json` — read-only; preserve the curated list
- (new file) `docs/env-audit.md` — the fleet audit report
- `docs/nginx-vhost-audit.md` — read-only reference for report structure
- `backlog.md` — capture discovered gaps as follow-ups

## Acceptance criteria
- [x] `requiredEnvKeys` is declared for every live project that can support it (develemail, emit-social, tastease, diner-decider), with emit-vision's existing list preserved unchanged.
- [x] `martialops` and `test-smoke` are explicitly skipped with recorded reasons.
- [x] `GET /projects/<name>/secrets-drift` returns a real status (not `unconfigured`) for every project with declared keys.
- [x] Compose `${VAR}` references were compared against server keys for each audited project, and mismatches are flagged.
- [x] `docs/env-audit.md` exists with a summary table and per-project findings, following `docs/nginx-vhost-audit.md`'s structure, covering the email senders first.
- [x] Every genuine gap is captured in `backlog.md`.
- [x] No production server was modified by this sprint.
- [x] `pnpm typecheck`, `pnpm test`, `pnpm lint` clean across all 5 projects.

## Completed

**Date:** 2026-07-24

### Summary
Declared `requiredEnvKeys` for the four live projects that lacked it (develemail: 15 keys, emit-social: 26, tastease: 42, diner-decider: 44), using `emit-infra secrets scaffold-required-keys --dry-run` then a real write for each, leaving emit-vision's pre-existing 36-key curated list untouched. For every project, cross-checked the scaffolded (server-derived) list against `docker-compose*.yml` `${VAR}` references and, where compose uses blanket `env_file:` passthrough instead of explicit substitution (tastease, diner-decider's app services), against `.env.example` instead.

This surfaced two genuine, previously invisible gaps: develemail's server is completely missing `INBOUND_SECRET` (referenced with no fallback by both the `api` and `inbound` services — the shared secret for inbound SMTP-to-API auth), and diner-decider has four S3/storage credential keys present but empty (`BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`) — likely silently broken backups and file storage. Neither was remediated (out of scope); both are logged as `[blocker]` backlog items with full detail in `docs/env-audit.md`.

martialops and test-smoke were skipped as instructed, but martialops produced an unexpected sub-finding: its declared `serverIp` isn't a dead/placeholder value as its "shelved" status implies — it's tastease's live production server (confirmed via matching `status` route output: identical uptime, disk, memory across both projects' IPs). martialops genuinely has nothing deployed there under its own name (`scaffold-required-keys --dry-run` correctly reports no `/opt/martialops/.env`), so this sprint's criteria are unaffected, but any future deploy-shaped command run against martialops would SSH into tastease's live box rather than failing cleanly. Logged as a third `[blocker]` backlog item since the correct fix isn't determinable from read-only audit.

All five `.emit-infra.json` edits are schema-validated by the existing zod config schema (implicitly proven: `loadConfig` succeeded for every write, and every subsequent live drift query against the edited files returned a real status rather than a parse error).

### Files changed
- `~/projects/develemail/.emit-infra.json` — added `requiredEnvKeys` (14 scaffolded + `INBOUND_SECRET` added manually after compose comparison)
- `~/projects/emit-social/.emit-infra.json` — added `requiredEnvKeys` (26 keys, scaffolded as-is)
- `~/projects/tastease/.emit-infra.json` — added `requiredEnvKeys` (42 keys, scaffolded as-is)
- `~/projects/diner-decider/.emit-infra.json` — added `requiredEnvKeys` (44 keys, scaffolded as-is)
- `~/projects/emit-vision/.emit-infra.json` — untouched, confirmed preserved
- (new) `docs/env-audit.md` — the fleet audit report
- `backlog.md` — 3 new `[blocker]` follow-up items (develemail `INBOUND_SECRET`, diner-decider empty storage/backup credentials, martialops stale `serverIp`)

### Verification
- `GET /projects/develemail/secrets-drift`: `status: "drift"`, `missing: ["INBOUND_SECRET"]`
- `GET /projects/emit-social/secrets-drift`: `status: "ok"`
- `GET /projects/tastease/secrets-drift`: `status: "ok"`
- `GET /projects/diner-decider/secrets-drift`: `status: "drift"`, `empty: [4 storage/backup keys]`
- `GET /projects/emit-vision/secrets-drift`: `status: "ok"` (unchanged, 36 keys)
- `emit-infra secrets scaffold-required-keys martialops --dry-run`: clean "no keys found" (not unreachable) — confirms server is live but martialops isn't deployed there
- `GET /projects/test-smoke/status`: `{"error":"unreachable"}` as expected
- `pnpm typecheck`: clean across all 5 projects (cached, unaffected by out-of-repo config edits)
- `pnpm test`: 188/188 pass (dashboard), cached clean across all test-bearing projects
- `pnpm lint`: clean across all 5 projects
- No production server env was modified — every write this sprint targeted a local `.emit-infra.json`; all server-facing calls were read-only (`--dry-run`, `status`, `secrets-drift`)

### Follow-ups
- `[blocker]` develemail is missing `INBOUND_SECRET` on its production server entirely — needs a real secret generated and set. See `docs/env-audit.md` and `backlog.md`.
- `[blocker]` diner-decider has 4 empty S3/storage credential keys in production — backups and file storage likely broken. See `docs/env-audit.md` and `backlog.md`.
- `[blocker]` martialops' `.emit-infra.json` `serverIp` points at tastease's live production server rather than being genuinely absent — needs investigation by someone who knows the history (stale leftover vs. intentional). See `docs/env-audit.md` and `backlog.md`.
- `[defer]` emit-social's four compose-referenced-but-server-absent vars (`DEVELEMAIL_CAMPAIGN_MAP`, `INTEGRATION_DEVELEMAIL`, `INTEGRATION_EMIT_VISION`, `INTEGRATION_STRIPE`) are intentionally optional (explicit `${VAR:-}` defaults) — no action needed, noted for completeness.

## Out of scope
- **Adding or changing any secret on any production server** — findings are reported, not remediated. Remediation needs per-project value decisions and explicit approval.
- Regenerating emit-vision's curated `requiredEnvKeys`.
- Provisioning a server for martialops.
- Inferring required env from application source code beyond compose `${VAR}` references.
- Changing drift-route, deploy, or `secrets-apply` behavior — sprints 238-242 own those.
