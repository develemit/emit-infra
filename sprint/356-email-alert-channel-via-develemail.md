# Add an email alert channel via develemail behind a single notify() dispatcher
**Difficulty:** 3

## Goal
The emit-infra API can send email through develemail, and there is one
`notify()` function that delivers an alert to every configured channel — Web
Push (as today) plus email. No call sites change yet; that's sprint 357.

## Reason
Every alert emit-infra produces (cert expiry, disk/mem, downtime, deploy
outcome, weekly digest) goes through `sendToAll()` in
`apps/api/src/lib/push.ts`, which is Web Push only. On 2026-10-06
`~/.emit-infra/push.json` had **0 subscriptions**, so every alert was being
delivered to nobody — very likely why diner-decider's cert expired on
2026-09-13 with no warning. Push alone isn't enough: subscriptions silently
vanish (pruned on 404/410, lost when a browser profile resets). Email to
emitdutcher@gmail.com is a channel that doesn't go away.

## Context
- **API stack:** Fastify 4, ESM, zod, vitest. `apps/api/package.json` deps:
  fastify, web-push, zod, execa, `@emit-infra/core`. The API runs **locally
  only** under launchd (`com.emit.infra`, port 7001); restart it with
  `pnpm launch` (not `touch`) after changes.
- **Env:** `apps/api/.env` (gitignored) + `apps/api/.env.example` (tracked).
  The API is not deployed anywhere, so there's no `.env.prod` to sync.
- **Wiring develemail:** follow the `/wire-develemail` skill
  (`~/.claude/commands/wire-develemail.md`):
  - Step 0: check `~/.config/develemail/auth.json`. If it's missing, **stop
    and ask the user** to run `devel login --url https://mail.develemail.com`
    themselves. Never pass `--password` on the command line.
  - Provision with `devel init --project emit-infra --env-file apps/api/.env
    --key-name alerts --env production`. This writes `DEVELEMAIL_BASE_URL`
    and `DEVELEMAIL_API_KEY`.
  - Use **`@develemail/sdk`**, not the Fastify plugin. `notify()` is called
    from background loops (`status-monitor.ts`, `digest-scheduler.ts`) that
    have no `app` instance, so a plain lazy-singleton module (the skill's
    Next.js-style `getClient()` / `sendEmail()` pattern) fits; a plugin
    decorator doesn't.
  - Skip `@develemail/react`. Alert mail is plain HTML built from strings, and
    the API has no React dependency.
- **Sender address:** use a sender on a domain develemail already has
  verified. Check with `devel` (domains/senders) and record the choice in
  `.env.example` as `ALERT_EMAIL_FROM`. The recipient is `ALERT_EMAIL_TO`
  (default `emitdutcher@gmail.com`, the same address as `VAPID_SUBJECT` in
  `push.ts`).
- **Correlated failure, by design:** develemail is itself a fleet server
  (178.105.171.1). If it's down, email about develemail can't go out. That's
  why push stays a channel, and why sprint 358's emit-vision pulse checks act
  as an independent path. Note this in the `notify.ts` header comment.
- **`sendToAll` contract:** returns `{ sent, pruned }` and never throws past
  callers (they `.catch()`). `notify()` must also never throw. It should
  return per-channel results so callers can log them.

## Tasks
1. Run `/wire-develemail` Step 0 for project `emit-infra` against
   `apps/api/.env`. Pause for the user if a login is needed.
2. `pnpm --filter @emit-infra/api add @develemail/sdk`.
3. New `apps/api/src/lib/email.ts`:
   - a lazy client;
   - `sendEmail({ subject, html, text })` returning `{ ok } | { ok:false, error }`;
   - a no-op `{ ok:false, error:'not configured' }` when the env vars are
     missing.
4. New `apps/api/src/lib/notify.ts`:
   - `notify(payload: NotifyPayload)`, where `NotifyPayload` extends
     `PushPayload` with an optional `emailHtml` and a
     `severity: 'info' | 'alert'`.
   - Always pushes.
   - Emails only when `severity === 'alert'` or the payload sets
     `email: true`.
   - The default email body is built from title/body/url, with the url
     resolved against the dashboard origin. Read the dashboard origin from
     existing config. Don't hardcode it if it's already defined somewhere.
   - Returns `{ push: {sent, pruned}, email: {ok, error?} }`.
5. Add `ALERT_EMAIL_TO`, `ALERT_EMAIL_FROM`, `DEVELEMAIL_BASE_URL` and
   `DEVELEMAIL_API_KEY` (placeholder) to `apps/api/.env.example`.
6. Extend `POST /push/test` in `apps/api/src/routes/push.ts` (or add
   `POST /notify/test`, whichever reads cleaner) so a test fires through
   `notify()` with `email: true`. Send one real test email and confirm with
   the user that it arrived.
7. Unit tests with the develemail client and web-push mocked.

## Files involved
- new file: `apps/api/src/lib/email.ts`: develemail client wrapper
- new file: `apps/api/src/lib/notify.ts`: multi-channel dispatcher
- new file: `apps/api/src/lib/notify.test.ts`
- new file: `apps/api/src/lib/email.test.ts`
- `apps/api/src/routes/push.ts`: test endpoint goes through `notify()`
- `apps/api/.env.example`: new vars
- `apps/api/package.json`, `pnpm-lock.yaml`: new dependency

## Acceptance criteria
- [ ] `notify()` with `severity:'alert'` calls both push and email. With
      `severity:'info'` it calls push only. A throwing email client still
      returns a result and never rejects. Covered in `notify.test.ts`.
- [ ] `sendEmail()` returns `{ok:false}` without throwing when env vars are
      absent. Covered in `email.test.ts`.
- [ ] A real test email reached emitdutcher@gmail.com (the user confirmed),
      sent after restarting the API with `pnpm launch`.
- [ ] No secrets in tracked files. `apps/api/.env` stays gitignored.
- [ ] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass. This repo has no
      `check:affected`, and the lockfile changed, so run the full suite.

## Out of scope
- Switching existing `sendToAll` call sites to `notify()` (sprint 357).
- emit-vision pulse checks (sprint 358).
- Email preferences UI in the dashboard.
