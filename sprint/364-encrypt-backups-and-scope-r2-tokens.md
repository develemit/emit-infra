# Encrypt offsite backups, narrow R2 tokens, and lock backup objects
**Difficulty:** 4

## Goal
Offsite DB dumps are encrypted with `age` before they leave the server. The
private key never touches a server. Each server's backup credential is
scoped to its own bucket. R2 bucket lock rules stop backups from being
deleted for 7 days, even by a leaked key. `emit-infra backup verify`
(sprint 361) decrypts transparently.

## Reason
Before this sprint:
- dumps land in R2 in plaintext, so anyone holding an R2 key has every
  user's data;
- the keys sitting in each app's server `.env` can also **delete** those
  backups, so an attacker on the box, or a buggy retention loop, can erase
  the recovery path along with the database.

Encryption plus a write-scoped token plus object lock fixes both without
adding operational toil.

## Context
- **Current pipeline:** after sprint 359, every DB project's sidecar uploads
  to R2 and writes `.backup-status.json`. Read `docs/BACKUP-INVENTORY.md` for
  per-project buckets and sidecars.
- **Encryption:**
  - Use `age` with an X25519 recipient (public key on servers via the env,
    `BACKUP_AGE_RECIPIENT`). Pipe: `pg_dump … | age -r "$BACKUP_AGE_RECIPIENT"
    > x.dump.age`.
  - The sidecar images are alpine-based, so `apk add age` works; check
    `eeshugerman/postgres-backup-s3`, which may need a custom entrypoint
    install.
  - The private key lives on the Mac at `~/.emit-infra/backup-age.key`
    (0600) **and** in the user's password manager. Ask the user to store it
    there, and record that they confirmed.
  - One fleet-wide key pair is fine.
- **Env sourcing:** `BACKUP_AGE_RECIPIENT` goes in each project's local
  `ci.envFile`, because deploy overwrites the server `.env`.
- **R2 token scope:**
  - Cloudflare R2 API tokens can be scoped to specific buckets, with
    "Object Read & Write" or "Object Read only". There's no write-only
    permission, which is why object lock is the real delete protection.
  - Create one token per project bucket, and remove the backup role from
    any broader token the app `.env` currently holds. Check whether the app
    also uses the same R2 key for user uploads (diner-decider uses R2 for
    photos), and **don't break that**.
  - Follow `apps/cli/src/commands/r2-rotate-token.ts` and the martialops
    `r2-backup-token.env` precedent.
- **Bucket lock:**
  - R2 supports bucket lock rules (retention by prefix and age). Apply a
    7-day retention to the backup prefix with `wrangler r2 bucket lock add`,
    or the Cloudflare API with the account token. Check the current
    `wrangler` syntax.
  - The sidecars' own retention deletes (`find -mtime`, `aws s3 rm`) will
    then fail on locked objects younger than 7 days. Make retention ≥ the
    lock period and tolerant of lock errors.
- **Verify:** extend `apps/cli/src/lib/backup-verify.ts` so `*.age` keys
  are decrypted with `age -d -i ~/.emit-infra/backup-age.key` before
  restore. A missing key gives a clear error.
- **Backward compatibility:** old plaintext dumps stay until they age out.
  `verify` must handle both.

## Tasks
1. Generate the key pair with `age-keygen`. Store it on the Mac and have the
   user confirm the password-manager copy.
2. Update each DB project's sidecar to encrypt, add `.age` to the key name,
   and keep the status contract intact.
3. Create bucket-scoped R2 tokens. Swap them into each project's
   `ci.envFile`, then deploy. Revoke the old broad backup credential once
   uploads succeed with the new one.
4. Add 7-day bucket lock rules. Prove one works by trying to delete a fresh
   backup object with the server's token, and capture the refusal.
5. Extend `backup verify` to decrypt. Re-run it for every DB project.
6. Update `docs/BACKUP-INVENTORY.md` (encrypted / scoped / locked columns)
   and `docs/DISASTER-RECOVERY.md` (decrypt step, key location).

## Files involved
- `apps/cli/src/lib/backup-verify.ts` (+ test), `apps/cli/src/commands/backup-verify.ts`
- other repos' `docker-compose.prod.yml` sidecars and local env files
- `docs/BACKUP-INVENTORY.md`, `docs/DISASTER-RECOVERY.md`

## Acceptance criteria
- [ ] `backup-verify.test.ts` covers that `.age` keys get a decrypt step and
      that a missing key file gives an actionable error.
- [ ] The newest dump for every DB project is `.age`, and `backup verify`
      succeeds on each one.
- [ ] A delete attempt on a locked object was refused (output captured in
      the inventory doc).
- [ ] No server `.env` holds a backup credential that can touch another
      project's bucket.
- [ ] The user confirmed the private key is in their password manager.
- [ ] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass here, and each
      changed repo's suite passes.

## Out of scope
- Removing the HCLOUD / Cloudflare tokens from server `.env`s. That's
  related but separate; backlog it.
- Key rotation tooling.

### Approved by the user (2026-10-06, "approve all")
The production actions this sprint describes are approved. Proceed without asking again, with these exceptions where you must still stop for the user:
- confirming a real email arrived;
- any step that needs the user's password manager;
- any server **reboot**.

Guardrails:
- deploy sibling repos only through `~/projects/emit-infra/scripts/deploy-detached.sh --dir <repo>`;
- skip a repo whose tree is dirty or that has an active sprint loop (record it as deferred);
- before deploying a sibling repo, run `git log origin/main..HEAD --oneline`. If it carries **other people's unpushed commits that include DB migrations**, skip it and report. Otherwise proceed, and list the extra commits in Completed;
- Terraform: apply only plans that are in-place updates;
- SSH changes: one server at a time, with a second session held open.
