# Disarm secrets-apply: correct env source, merge instead of truncate, back up first
**Difficulty:** 4

## Goal
The dashboard's "Sync to server" button must never destroy production secrets. `POST /projects/:name/secrets-apply` should read the same env file the deploy path uses, **merge** keys into the server's existing `/opt/<name>/.env` rather than truncating it, and back the file up before writing.

## Reason
This is a live, one-click production foot-gun — not a hypothetical. The route resolves `.env.prod` first and **ignores `config.ci.envFile`**, then writes with `>` (truncate). For emit-vision, `.env.prod` has 9 keys while the server has 37, so **a single click on "Sync to server" destroys 28 production secrets** — `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `CLICKHOUSE_PASSWORD`, `SSO_ENCRYPTION_KEY`, all Stripe keys, all R2 credentials. Verified against the live server 2026-07-24.

The trap is perfectly baited: the button only renders when `missing.length > 0` (`secrets-panel.tsx:64`). So the natural workflow — *add a new required secret → dashboard shows it missing → click "Sync to server"* — is exactly what wipes the server. The panel's framing ("N missing", "Sync to server") promises an additive fix; the implementation does a wholesale replace. This gap was **not** in the emit-vision team's report; it was found while validating their findings, and it is more urgent than the deploy-path gap (sprint 241) because that one is latent while this one is armed today.

## Context
- **Route:** `apps/api/src/routes/secrets-sync.ts`, the `POST /projects/:name/secrets-apply` handler at lines ~43-86.
  - Env source resolution (~lines 56-58): `existsSync(join(projectDir, '.env.prod')) ? '.env.prod' : '.env'` — note it builds `projectDir` from `homedir()/projects/<name>` and **never consults `project.config.ci?.envFile`**.
  - The write (~line 80): `sshExec(host, \`echo -n '${b64}' | base64 -d > /opt/${name}/.env\`, key)`.
  - There is a deliberate base64 safety assertion just above the write (`/^[A-Za-z0-9+/=]+$/`) because `sshExec` has no stdin support — **keep this defense**, it is not incidental.
- **What deploy uses instead** (`apps/cli/src/commands/deploy.ts:143`): `[config.ci?.envFile, '.env.prod', '.env']`, first match wins. Aligning the API route to this precedence is the fix for the *source* half. `project.config` is already available from `findProject`, so `project.config.ci?.envFile` needs no new plumbing.
- **Merge semantics is the right design, not replace.** The panel reports missing/extra/present and offers to fix "missing" — the intent has always been upsert. Merge also naturally preserves `BUILD_NUMBER`, which the Ansible `lineinfile` task writes post-copy (`ansible/roles/app-deploy/tasks/main.yml:37-43`) and which exists only on the server.
- **Implementation shape:** read the server's current `.env` over SSH, parse it, overlay the local file's entries on top (local wins for shared keys, server-only keys are preserved), then write the merged result back. That's a read-then-write, so two `sshExec` calls — acceptable here. Reuse the existing `parseEnvFile` helper in this file for both sides.
- **Backup before write:** `cp /opt/<name>/.env /opt/<name>/.env.bak-<timestamp>` on the server, in the same command as the write or immediately before it. The emit-vision team did this by hand (`/opt/emit-vision/.env.bak-pre-develemail-20260724`); it should be automatic.
- **Tests:** `apps/api/src/routes/secrets-sync.test.ts` already covers this route (404, missing env file, empty secrets, success, SSH failure) and mocks `sshExec`. Follow its existing mocking style. With two SSH calls you'll need `mockResolvedValueOnce` sequencing for read-then-write.
- **Response shape:** return a summary the UI can show — e.g. `{ ok: true, added: string[], updated: string[], preserved: number }`. Keep it additive so the existing dashboard call site (`apps/dashboard/src/lib/api-secrets.ts:13`) keeps working without changes.
- **Verification:** the local API runs on `:7001`. Do **not** POST `secrets-apply` against a live project as a test — that mutates production. Verify via unit tests and, if you want a live read-only sanity check, `GET /projects/emit-vision/secrets-drift` before and after (it should be unchanged, since you are not applying anything).

## Tasks
1. Change the env-source resolution in the `secrets-apply` handler to match deploy's precedence: `config.ci?.envFile`, then `.env.prod`, then `.env` — first existing file wins. Keep the 404 when none exists.
2. Read the server's current `/opt/<name>/.env` over SSH before writing (tolerate absence — a first-time apply should still work, treating the server side as empty).
3. Merge: parse both sides with the existing `parseEnvFile`; local entries overwrite same-named server entries; **server-only keys are preserved verbatim**. Compute `added`, `updated`, and `preserved` counts/lists while merging.
4. Back up the existing server `.env` to `/opt/<name>/.env.bak-<YYYYMMDDHHMMSS>` before writing the merged file. Skip the backup if there was no existing file.
5. Write the merged content using the existing base64 approach, keeping the `/^[A-Za-z0-9+/=]+$/` payload assertion intact.
6. Return `{ ok: true, added, updated, preserved }`. Do not change the error shapes.
7. Update `apps/api/src/routes/secrets-sync.test.ts`: cover (a) `ci.envFile` taking precedence over `.env.prod`, (b) server-only keys surviving the merge, (c) the backup command being issued, (d) first-time apply with no existing server file, (e) local values overwriting server values for shared keys.
8. Run `pnpm test`, `pnpm typecheck`, and `pnpm lint` — **the full monorepo, all 5 projects**, not just `api`.

## Files involved
- `apps/api/src/routes/secrets-sync.ts` — env-source precedence, read-merge-write, backup, richer response
- `apps/api/src/routes/secrets-sync.test.ts` — new coverage for precedence, merge preservation, backup, first-time apply
- `apps/dashboard/src/lib/api-secrets.ts` — read-only reference; the response stays backward-compatible so no change expected

## Acceptance criteria
- [x] `secrets-apply` resolves its env source as `[ci.envFile, .env.prod, .env]`, matching `deploy.ts:143`.
- [x] Keys present on the server but absent from the local env file are **preserved**, not deleted. A test proves this explicitly.
- [x] The server `.env` is backed up to a timestamped file before any write.
- [x] Local values win over server values for keys present in both.
- [x] The base64 payload assertion is still present and enforced.
- [x] The response reports what changed (`added` / `updated` / `preserved`).
- [x] `pnpm test`, `pnpm typecheck`, `pnpm lint` all clean across all 5 projects.

## Out of scope
- The deploy-path (`copy_env`) guardrail — that's sprint 241, a different layer (Ansible + CLI).
- Empty-value detection in the drift route and the `unconfigured` visibility fix — sprint 239.
- The `secrets scaffold-required-keys` command — sprint 240.
- Documenting the two-file split — sprint 242.
- Changing the dashboard panel's button copy or adding a confirmation dialog. Merge semantics makes the action safe; UI polish can follow separately if wanted.
- Any live `POST secrets-apply` against a production project.

## Completed

**Date:** 2026-07-24

### Summary
Rewrote the `POST /projects/:name/secrets-apply` handler in `apps/api/src/routes/secrets-sync.ts` to eliminate the truncate-and-destroy foot-gun. Env-source resolution now matches `deploy.ts`'s precedence (`config.ci?.envFile` → `.env.prod` → `.env`, first existing file wins) instead of ignoring `ci.envFile` entirely. Before writing, the handler reads the server's current `/opt/<name>/.env` over SSH (tolerating a missing file via a sentinel-marker shell probe: `[ -f ... ] && cat ... || echo '__EMIT_INFRA_NO_ENV__'`), merges local entries on top (local wins on shared keys, server-only keys pass through verbatim), and only then writes. A timestamped backup (`cp ... .env.bak-<YYYYMMDDHHMMSS>`) is chained into the same write command whenever a prior file existed — skipped cleanly on first-time applies. The base64 payload assertion was left untouched. The response grew from `{ ok: true }` to `{ ok: true, added, updated, preserved }`, which is additive and required no dashboard change (`apps/dashboard/src/lib/api-secrets.ts` only reads `ok`/`error`).

The merge logic (`mergeEnv`) is a small pure function so it's easy to reason about and could be unit-tested directly, though coverage here follows the existing file's convention of testing through the route with mocked `sshExec`.

### Files changed
- `apps/api/src/routes/secrets-sync.ts` — precedence-aware env source resolution, read-merge-write flow with server-side existence probe, timestamped backup, richer response shape
- `apps/api/src/routes/secrets-sync.test.ts` — added coverage for `ci.envFile` precedence, server-only key preservation, local-wins-on-shared-keys, backup issuance, and first-time-apply backup skip; updated the happy-path test for the new two-SSH-call flow

### Verification
- `pnpm test`: 334/334 pass (all 5 projects)
- `pnpm typecheck`: clean (all 5 projects)
- `pnpm lint`: clean (all 5 projects)
- No live `POST secrets-apply` was issued against any project, per the sprint's explicit constraint.

### Follow-ups
- `[defer]` The server-existence probe relies on a sentinel string (`__EMIT_INFRA_NO_ENV__`) rather than a structural signal (e.g. separate exit-code check); fine for now since the marker is namespaced and can't collide with real env content, but worth revisiting if the SSH exec helper ever grows exit-code visibility.
- `[defer]` `mergeEnv` and `formatTimestamp` are pure and unexported; if a future sprint wants direct unit tests for them (rather than only through the route), export them.
