# Untrack develemail's `docker-compose.override.yml` without losing the fixes it carries
**Difficulty:** 2

> _Promoted from backlog: sprint-281 follow-up, 2026-08-22._
> _Target repo: `~/projects/develemail` (not emit-infra)._

## Goal
`develemail/docker-compose.override.yml` is untracked and genuinely local, and
its `.example` counterpart carries every fix the tracked copy had — so a fresh
`cp` produces a working stack.

## Reason
The file is listed in `.gitignore` (line 67, with the comment "copy from
docker-compose.override.yml.example") and `CLAUDE.md:122` documents it as
"gitignored; customize locally" — but **it is tracked in git**. It was committed
before the ignore rule was added and never untracked; the last commit touching
it is `5131be3` (2026-07-26). So one machine's local customizations are shipping
to everyone, and `.gitignore` silently does nothing for it.

## Context — read this before running `git rm --cached`

**A naive untrack loses real work.** The tracked override and the `.example`
have diverged in *both* directions. Diff as of 2026-08-22:

**In the override, missing from `.example` — these are fixes, keep them:**
- `RUN_MIGRATIONS: 'true'` on the api service.
- `UNSUBSCRIBE_SECRET` / `ENCRYPTION_KEY` given dev defaults via
  `${VAR:-default}`, on both api and worker. The in-file comment explains why:
  *"The worker refuses to start without one of these (campaign unsubscribe links
  need them), which crash-looped the local stack until this override caught up
  with its own .example file."* The `.example` still has the bare `${VAR}` form
  that caused that crash-loop.
- The api healthcheck uses `http://127.0.0.1:3001/health`, not `localhost`, with
  the comment: *"/etc/hosts maps localhost to both 127.0.0.1 and ::1, wget tries
  IPv6 first, and the server binds IPv4 only — so this probe failed against a
  perfectly healthy API."* The `.example` still says `localhost`.

**In `.example`, missing from the override — decide per item:**
- A whole `inbound` service block (build context, `INBOUND_PORT: 2526`,
  `API_URL`, secrets, `depends_on: api healthy`).
- `INBOUND_SECRET` on the api service.
- `NOTIFICATION_FROM_ADDRESS: noreply@mail.localhost` with an SPF/DKIM note.
- Commented-out `WORKER_CONCURRENCY` and the Mailpit relay-driver block.
- The PgBouncer explanation comment in the header.

So the correct end state is a **merged** `.example`: the fixes from the tracked
override, plus everything `.example` already documents. The override's absences
are probably just "this machine doesn't run `inbound` locally" — that's exactly
the kind of local choice that belongs in an untracked file, not a deletion from
the template.

**Ordering matters.** Once you `git rm --cached`, the file becomes invisible to
git — capture the diff *first*.

**Do not break the running local stack.** The working copy on disk must survive
untouched; `git rm --cached` alone does that, but a subsequent `git checkout` or
branch switch after the removal commit could tempt someone to "restore" it.

## Tasks
1. Capture the current tracked content (`git show HEAD:docker-compose.override.yml`)
   somewhere safe before touching anything.
2. Merge the override's three fixes into
   `docker-compose.override.yml.example`: `RUN_MIGRATIONS`, the `${VAR:-default}`
   secret defaults on both services, and the `127.0.0.1` healthcheck — carrying
   their explanatory comments across verbatim. Those comments are the record of
   two debugging sessions; they're worth more than the lines they annotate.
3. Review each item the `.example` has and the override lacks. Anything that
   belongs in the template stays in the template.
4. `git rm --cached docker-compose.override.yml` — file stays on disk, leaves
   the index.
5. Verify `.gitignore` now actually takes effect: `git status` shows the file as
   neither tracked nor untracked-and-listed.
6. Confirm `CLAUDE.md:122`'s onboarding instruction is now true — a fresh
   `cp docker-compose.override.yml.example docker-compose.override.yml` should
   produce a stack that starts. **Actually run it** in a scratch copy rather
   than reasoning about it; both fixes being merged exist precisely because
   reasoning about it was wrong twice before.
7. Check `CLAUDE.md:102`'s other mention for accuracy while you're there.
8. Commit in develemail with a message explaining why the file was tracked and
   what moved to `.example`.

## Out of scope
- develemail's 9 pre-existing failing `e2e-smoke` tests (separately filed).
- Any change to the running local stack's behaviour, or to
  `docker-compose.yml` / `docker-compose.prod.yml`.
- Auditing other repos for the same tracked-but-ignored pattern. If you notice
  one in passing, file it.

## Acceptance criteria
- `git ls-files --error-unmatch docker-compose.override.yml` fails (untracked).
- The file still exists on disk with its content intact.
- `docker-compose.override.yml.example` contains all three fixes from the
  tracked copy, comments included.
- A fresh copy of `.example` to `.override` brings the stack up — show the
  command run and the result, not an assertion that it would work.
- `CLAUDE.md`'s two mentions are accurate.
- Committed in develemail, with the reasoning in the commit message.

## Completed

**Date:** 2026-08-23

### Summary
Executed in `~/projects/develemail` per the sprint's target-repo note (no
emit-infra files touched). Captured the tracked override's content to
`/tmp/override-tracked.yml` first, then merged its three fixes —
`RUN_MIGRATIONS: 'true'`, the `${VAR:-default}` dev fallbacks for
`UNSUBSCRIBE_SECRET`/`ENCRYPTION_KEY` on api and worker, and the
`127.0.0.1` (not `localhost`) api healthcheck — into
`docker-compose.override.yml.example`, carrying their explanatory comments
across verbatim. Everything `.example` already had that the override lacked
(the `inbound` service block, `INBOUND_SECRET`, `NOTIFICATION_FROM_ADDRESS`,
commented `WORKER_CONCURRENCY`/relay block, PgBouncer header comment) was
left in place — those are template features, not things the override's
absence should delete.

Ran `git rm --cached docker-compose.override.yml`; the file stays on disk
byte-for-byte (diffed against the `/tmp` capture — identical) and drops out
of the index, so `.gitignore` line 67 now actually takes effect.

Verified the "fresh copy works" claim empirically rather than by inspection:
rsynced the whole repo to `/tmp/develemail-scratch` (the real
`docker-compose.override.yml` was never touched — confirmed unchanged after
the fact), copied the merged `.example` to `.override` there, and ran
`docker compose up -d --build`. To avoid colliding on the fixed
`container_name`s and ports the base compose file uses, brought the real
local stack down first with `docker compose down` (no `-v`, named volumes
untouched) and back up afterward with the original untouched file —
confirmed `develemail-api` reports healthy again post-restore. In the
scratch run: postgres/mailpit/rspamd came up healthy, api reported healthy
via the new `127.0.0.1` probe, worker and web ran with no restarts, and the
newly-included `inbound` service started and listened on 2526 (its
`INBOUND_SECRET`/`ENCRYPTION_KEY` defaulted to blank with a compose warning,
same as the un-merged `.example` already behaved — out of scope to fix
further). `postfix` and `opendkim` failed the same way they did before this
change (`ALLOWED_SENDER_DOMAINS` unset, opendkim exit 78) — a pre-existing
base `docker-compose.yml` issue, unrelated to the override/`.example` split
and explicitly out of scope.

Both `CLAUDE.md` mentions (line 102, line 122) were already accurate and
needed no edit — line 102 just references the file's role in the compose
network, line 122 already correctly describes it as gitignored, which is
now actually true.

### Files changed (in `~/projects/develemail`, not emit-infra)
- `docker-compose.override.yml` — untracked via `git rm --cached`; unchanged on disk.
- `docker-compose.override.yml.example` — merged the tracked override's three dev-fix values and their comments.

### Verification
- `git ls-files --error-unmatch docker-compose.override.yml`: fails (untracked) — confirmed both pre- and post-commit.
- `diff /tmp/override-tracked.yml docker-compose.override.yml`: no output (content intact).
- `git status --ignored --porcelain`: shows `!! docker-compose.override.yml` (ignored, not untracked-and-listed).
- Scratch `docker compose up -d --build` from a fresh `.example` copy: postgres/mailpit/rspamd/api healthy, worker/web/inbound running with 0 restarts; command output and container states captured in-session.
- `develemail`'s pre-commit hook (`format`/`lint`/`typecheck`/`test` on affected projects): passed, no affected projects for a compose-file-only change.
- Live local stack: brought back up with the original file after the scratch test; `develemail-api` reports healthy.
- Committed in develemail as `642c197`.

### Follow-ups
- `[defer]` develemail's `postfix`/`opendkim` containers fail to start locally (`ALLOWED_SENDER_DOMAINS` unset, opendkim exits with code 78) — pre-existing, unrelated to this sprint, noticed while bringing the stack up for verification.
- `[defer]` develemail's `docker-compose.yml` `opendkim` image (`instrumentisto/opendkim`) has no `linux/arm64/v8` build, so it runs under emulation on Apple Silicon hosts — noticed in passing, not investigated.
