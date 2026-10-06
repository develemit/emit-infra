# Connect emit-infra to emit-vision and heartbeat the local monitor
**Difficulty:** 3

## Goal
emit-infra has an emit-vision project. The local status monitor pings an
emit-vision **pulse check** after every successful poll cycle. If the Mac
sleeps, loses network, or the API crashes, emit-vision notices the missing
heartbeat and emails the user.

## Reason
All of emit-infra's monitoring runs inside the local API on the user's Mac.
When the Mac is asleep or offline, nothing watches production and nothing
says so. The silence looks exactly like "all healthy". A dead-man's switch
hosted somewhere else turns "the monitor is gone" into an alert. emit-vision
already ships this feature as pulse checks (dead-man's switch with
`expectedIntervalSeconds` and `graceSeconds`, plus email, Slack, webhook or
PagerDuty alert channels), so this needs no new vendor.

## Context
- **Connecting:** follow `/emit-vision-init` (`~/.claude/commands/emit-vision-init.md`).
  - Project name: `emit-infra`.
  - It writes `.emit-vision.json` (`{projectId}`, committed, no secrets).
  - The skill writes the ingest key to `.env.prod` by default. **This repo
    has no prod deployment**, so put `EMIT_VISION_INGEST_KEY` and
    `EMIT_VISION_PROJECT_ID` in `apps/api/.env` (gitignored) instead, and
    placeholders in `apps/api/.env.example`.
  - Check `git check-ignore apps/api/.env` first.
  - If `emit-vision status --json` isn't `valid`, ask the user to run
    `emit-vision login --browser`.
- **Skip the SDK snippet:** don't install `@emit-vision/sdk-js`. Only pulse
  pings are needed, and `docs/decisions/no-dogfooding.md` in emit-vision
  advises against self-instrumentation.
- **Pulse API** (emit-vision repo, `apps/api/src/routes/v1/pulse.ts`):
  - `GET|POST https://api.emitvision.com/v1/pulse/<slug>` for success;
  - `.../<slug>/fail` for failure;
  - header `Authorization: Bearer <ingest key>`;
  - optional `?release=`;
  - slugs match `^[a-z0-9][a-z0-9-]{0,63}$`.
- **Creating the check:** use the CLI, `emit-vision pulse init --name
  emit-infra-monitor --interval 300 --grace 600`. The monitor polls every
  `POLL_MS` (check its value in `status-monitor.ts` and size the interval to
  match). The grace covers a slow poll.
- **Email channel:** alert channels are set through the pulse-admin API
  (`apps/api/src/routes/v1/pulse-admin.ts`, schema `{type:'email',
  address}`). Check whether `emit-vision pulse` has a flag for it first. If
  not, call the admin endpoint with the CLI's PAT, or set it in the
  emit-vision web UI and record which you did.
- **Ping placement:** in `poll()` in `apps/api/src/lib/status-monitor.ts`,
  after `Promise.allSettled`.
  - Ping success if at least one project probe completed (an empty project
    list is a monitor fault: ping `/fail`).
  - Pings are best-effort: 5s timeout via `AbortSignal.timeout`, never
    throw, never block the next poll.
  - Missing env means no-op with one warning at startup.
- **Cross-monitoring:** emit-vision's own server (46.225.249.8) is in the
  fleet the Mac watches. The Mac watches emit-vision and emit-vision watches
  the Mac. If both are down at once there's a gap. Document that in
  `docs/MONITORING.md`.
- **Sleep:** the launchd job runs under `caffeinate`, but lid-closed sleep
  still stops it. That's exactly the case this heartbeat exists to catch.

## Tasks
1. Run `/emit-vision-init` adapted as above (env → `apps/api/.env`).
2. Create the `emit-infra-monitor` pulse check with an email channel to
   emitdutcher@gmail.com.
3. New `apps/api/src/lib/pulse.ts` with `pingPulse(slug, { fail?, release? })`.
   Reused by later sprints.
4. Call it from `poll()` as described.
5. New `docs/MONITORING.md` covering:
   - what watches what;
   - the channels (push, email, emit-vision pulse);
   - the cross-monitoring gap;
   - how to silence a check during planned downtime.
6. Live test:
   - restart the API (`pnpm launch`) and confirm pings land (`emit-vision
     pulse status`);
   - stop it with `pnpm launch:stop` for longer than interval plus grace;
   - confirm the missing-heartbeat email arrived, then `pnpm launch` again.

## Files involved
- new file: `.emit-vision.json`
- new file: `apps/api/src/lib/pulse.ts` (+ `pulse.test.ts`)
- `apps/api/src/lib/status-monitor.ts`: heartbeat after each poll
- `apps/api/.env.example`: new placeholders
- new file: `docs/MONITORING.md`

## Acceptance criteria
- [ ] `pulse.test.ts` covers the success URL, the `/fail` URL, the bearer
      header, the timeout, no throw on network error, and no-op without env.
- [ ] A status-monitor test asserts a success ping after a poll with
      projects, and a fail ping with zero projects.
- [ ] `emit-vision pulse status` shows `emit-infra-monitor` healthy.
- [ ] The missing-heartbeat email arrived during the stop test (the user
      confirmed).
- [ ] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass.

## Out of scope
- Per-server uptime and backup pulses (sprint 360).
- Instrumenting emit-infra with the emit-vision SDK.
