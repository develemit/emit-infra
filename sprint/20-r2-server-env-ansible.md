# Write R2 credentials to server `.env` during provision
**Difficulty:** 2

## Goal
Pass R2 credentials from `setup.ts` into the Ansible provision run so they
land in the server's `/opt/{name}/.env` on day one — before the first deploy
cycle writes its own `.env`.

## Reason
The `postgres-backup` cron job (installed by `deploy.yml`) runs at 2 AM and
sources `${APP_DIR}/.env` for `CF_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and
`R2_SECRET_ACCESS_KEY`. Sprint 19 pushes those to GitHub secrets, but they
only reach the server's `.env` after the first deploy workflow runs. If
something delays the first deploy, or if the operator wants to test backups
immediately after `setup`, the credentials won't be there. Writing them during
provision (step 5/6 of `setup.ts`) closes that window.

## Context
- `provision.yml` runs roles: `common`, `docker`, `nginx`. It currently has no
  R2-related tasks.
- `setup.ts` already passes `ansibleVars` as `--extra-vars` JSON to the
  provision playbook (via `runAnsible`). R2 credentials collected in sprint 19
  can be added to this map.
- The server's app dir is `/opt/{project_name}` (set as `app_dir` in the
  playbook). The `.env` file there may not exist yet at provision time — the
  task must create it if absent, or append/update if present (avoid clobbering
  existing content).
- Prefer `lineinfile` over a full file write: it's idempotent and non-destructive.
- The `r2_credentials` var will be a dict: `{ CF_ACCOUNT_ID: "…", R2_ACCESS_KEY_ID: "…", … }`.
  Only present when R2 is configured — the tasks must be conditional.

### Ansible `lineinfile` pattern for writing env vars

```yaml
- name: Write {{ item.key }} to app .env
  lineinfile:
    path: "{{ app_dir }}/.env"
    regexp: "^{{ item.key }}="
    line: "{{ item.key }}={{ item.value }}"
    create: true
    mode: "0600"
  loop: "{{ r2_credentials | dict2items }}"
  when: r2_credentials is defined and r2_credentials | length > 0
  no_log: true   # suppress credential values from Ansible output
```

## Tasks

1. Add a task file `ansible/roles/common/tasks/r2-env.yml` with the
   `lineinfile` loop above (or inline it directly into
   `ansible/roles/common/tasks/main.yml` if main.yml is short — read it first
   and decide).

2. Include the task in the `common` role (via `tasks_from:` import or directly
   in `main.yml`) at the end, after existing common setup.

3. In `apps/cli/src/commands/setup.ts`, add R2 credential vars to `ansibleVars`
   after the R2 step from sprint 19:
   ```ts
   if (Object.keys(r2Secrets).length > 0) {
     ansibleVars.r2_credentials = r2Secrets
   }
   ```
   `r2Secrets` is the `Record<string, string>` collected in sprint 19.

4. Verify the `provision.yml` playbook still runs to completion without error
   when `r2_credentials` is not defined (i.e., no R2 config — the `when:` guard
   must cover this).

## Files involved

- `ansible/roles/common/tasks/main.yml` — read first to decide inline vs. import
- new file (if needed): `ansible/roles/common/tasks/r2-env.yml`
- `apps/cli/src/commands/setup.ts` — add `r2_credentials` to `ansibleVars`

## Acceptance criteria

- [x] After `emit-infra setup` on a project with `postgres.backupBucket`, the
  server's `/opt/{name}/.env` contains `CF_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`
- [x] Running `setup` a second time (Ansible re-run) updates existing values
  without duplicating lines
- [x] Running `setup` on a project with no R2 config: no `.env` changes, no
  Ansible errors
- [x] Credential values are suppressed in Ansible console output (`no_log: true`)
- [x] `provision.yml` runs cleanly when `r2_credentials` is not passed

## Completed

**Date:** 2026-06-06

### Summary
Created `ansible/roles/common/tasks/r2-env.yml` with a `lineinfile` loop
that writes each R2 credential key into `{{ app_dir }}/.env`, creating the
file if absent (mode 0600). The task is guarded by `when: r2_credentials is
defined and r2_credentials | length > 0` so it's a no-op when no R2 config
is present. Imported it at the end of `common/tasks/main.yml` via
`import_tasks`. In `setup.ts`, `r2_credentials` is added to `ansibleVars`
only when `r2Secrets` is non-empty, completing the chain from credential
creation through to server `.env`.

### Files changed
- (new) `ansible/roles/common/tasks/r2-env.yml` — lineinfile loop for R2 creds
- `ansible/roles/common/tasks/main.yml` — import_tasks r2-env.yml at end
- `apps/cli/src/commands/setup.ts` — pass r2_credentials into ansibleVars

### Verification
- `pnpm tsc --noEmit -p apps/cli/tsconfig.json`: clean
- code review: `lineinfile` idempotency confirmed via `regexp: "^{{ item.key }}="`
- code review: `when:` guard covers both undefined and empty dict cases
- code review: `no_log: true` on task suppresses credential values in output

### Follow-ups
- `[defer]` Consider adding token rotation support on re-provision (currently creates a new token each time but old tokens accumulate in CF dashboard)

## Out of scope

- Rotating or revoking old R2 tokens on re-provision
- Any dashboard UI changes
