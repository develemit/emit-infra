# QA page inventory — emit-infra dashboard

Source of truth for `/ui-deep-dive` runs. Written 2026-09-22.

## ⚠ Read this first: this dashboard operates production

Its buttons deploy, roll back, **destroy servers**, delete backups, restart
containers, and edit firewall rules, cron jobs, secrets and project config on
the live fleet. An audit must be able to click through all of it without any
of it reaching the API.

**Hard rule for every audit agent: drive the browser only through
`tools/ui-audit/read-only-guard.mjs` → `newGuardedContext(browser, …)`.** It
aborts every POST/PUT/PATCH/DELETE at the browser's network layer, blocks
backup downloads (a GET that copies a production DB dump to disk), and blocks
service workers, which would otherwise bypass interception. Never create a
browser context any other way. Never send a non-GET request with `curl` or any
other tool. Never start, restart, rebuild or reseed the dev stack, and never
run `pnpm build` (it clobbers the running dashboard's dev cache).

**Proof the guard works** — `tools/ui-audit/prove-guard.mjs`, run 2026-09-22,
`GUARD PROOF PASSED`:
- Against a local sentinel: fetch POST/PUT/PATCH/DELETE, XHR POST, form POST,
  `sendBeacon` and a backup-download GET were all blocked; only the allowed GET
  arrived.
- A real **Deploy** click on `test-smoke` sent `POST /api/projects/test-smoke/deploy`,
  which was blocked. No deploy process started, nothing reached the API log, and
  the project directory was unchanged. (`test-smoke`'s domain is `192.0.2.1`, a
  reserved unroutable address, so it's the safe target for any such test.)

Re-run the proof before every audit run:
`PLAYWRIGHT_PATH=<playwright package dir> node tools/ui-audit/prove-guard.mjs`

### What a blocked action looks like — not a bug

A blocked action surfaces in the UI as a failed or never-finishing request: a
button stuck on **"Running…"**, a panel that never streams output, an error
toast. That is the guard working. **Do not report it as a finding.** Judge
everything up to the moment the request would leave. The confirm dialogs,
warnings, wording and layout of the flow are all fair game.

### Other constraints
- **Screenshots go under `.ui-audit/` (gitignored), never into the repo.** Log
  pages show real production log output.
- **Every GET runs real read-only SSH against production servers** (status,
  containers, disk, logs). Close pages when done, and don't leave log streams
  open: `/projects/[name]/logs` holds an SSH connection for as long as it's open.
- The app runs as `next dev` under launchd, so expect a one-time compile delay
  on the first visit to each route. Wait it out rather than reporting it.

## App

| | |
|---|---|
| URL | `http://localhost:7013` (`:7000` is macOS AirPlay, not us) |
| API | `http://localhost:7001` (reached via the dashboard's `/api/*` rewrite) |
| Auth | none locally (`NEXT_PUBLIC_API_SECRET` unset) |
| Playwright | `~/projects/martialops/node_modules/.pnpm/playwright@1.62.1/node_modules/playwright` (chromium cached) |

## Dimensions

| Dimension | Values | How |
|---|---|---|
| Viewport | desktop `1440×900`; mobile `390×844` | context `viewport`. Mobile swaps the header actions for a fixed bottom action bar (`lg:hidden`) |
| Theme | `dark` (default), `light` | `context.addInitScript(() => localStorage.setItem('ec-theme', 'light'))` before first navigation; or the sidebar Dark/Light toggle |
| Data state | see per-page recipes | real projects, `test-smoke`, or a stubbed GET (below) |

### Seeding states without touching data

The only safe way to set up a state that real data doesn't show is to **stub a
GET response in the guarded context**:

```js
const { context } = await newGuardedContext(browser, { logFile, viewport })
await context.route('**/projects/tastease/status', (route) =>
  route.request().method() === 'GET'
    ? route.fulfill({ json: { ...realStatus, disk: 85 } })
    : route.fallback())   // fallback → the guard still sees everything else
```

Register stubs **after** `newGuardedContext` so they take precedence, and
always `fallback()` for anything you don't fulfil. Fetch the real response once
(GET) and modify it, so the shape stays correct.

### Real projects and what they naturally show

| Project | Natural state |
|---|---|
| `tastease`, `develemail`, `emit-vision`, `emit-billing`, `emit-social`, `martialops`, `diner-decider` | healthy, blue-green, real history |
| `test-smoke` | **unreachable** (SSH error branch), no history, no containers: the natural empty and error states |

## Pages

Legend for **Actions**: every one is blocked by the guard; walk up to it, judge
the flow, expect the request to fail.

### Fleet-level

| Page | Purpose | States to capture | Actions (blocked) |
|---|---|---|---|
| `/` Overview | project cards, billing widget, push opt-in | all healthy; with `test-smoke` unreachable (it's in the list); loading skeleton (throttle via a slow stub) | Register project (POST), push subscribe (POST) |
| `/projects` | re-exports the Overview (same component, second URL) | confirm it matches `/`; sidebar active state | same as `/` |
| `/health` | fleet health board, filter tabs | each filter tab; a degraded project (stub one `status` with `disk: 92`) | — (shows a "Last Deploy" column only) |
| `/health/incidents` | fleet incident timeline | real data; empty (stub the incidents GET to `[]`) | — |
| `/ci` | CI runs across the fleet, filter tabs | each tab; a failed run if one exists | — |
| `/logs` | fleet log entry point | as found | — |
| `/ops` | **"Ask Claude" ops chat: an AI operator that can act on servers** | empty thread; typed-but-unsent input | Send (POST `/ops/chat`, blocked); session DELETE on unload (blocked) |
| `/provision` | multi-step wizard for a new server | each step (basics → infrastructure → review) with valid and invalid input, desktop and mobile stepper | final submit (POST `/provision`). Walking the steps is client-side and safe |
| `/offline` | PWA offline fallback | direct visit | — |

### Per project — `/projects/[name]/…`

Use `tastease` for the healthy state and `test-smoke` for unreachable/empty,
unless a row says otherwise.

| Page | Purpose | States to capture | Actions (blocked) |
|---|---|---|---|
| `[name]` Detail | health card, containers, resource charts, sub-page cards | healthy; unreachable (`test-smoke`); **disk/memory ≥80% warning** (stub status `disk: 85` → "Deploy anyway"); range selector 24h/7d/30d | **Deploy** (fires immediately, no confirm), **Destroy** (opens modal), **Rollback** (opens panel), **Sync Secrets** (panel), **Ask Claude**, container restart |
| `[name]/pipelines` | deploy cadence, deploy and CI timelines | real history (`tastease` has the most); empty (`test-smoke`) | — |
| `[name]/deploy-log/[sha]` | one deploy's log | a real sha from `GET /api/projects/tastease/deploy-history`; a missing sha | — |
| `[name]/ci-log/[sha]` | one CI run's log | same approach via ci-history | — |
| `[name]/reliability` | SLA, incidents, alert history, server deaths | real; empty | incident annotation (PUT) |
| `[name]/networking` | response times, nginx endpoints/config, resource chart | real | — |
| `[name]/storage` | disk dirs/breakdown, Postgres table sizes, docker usage | real (`develemail` has Postgres) | **Prune** (POST) |
| `[name]/data` | backups and secrets | real; the **secrets panel shows key presence only, never values** (verified in the API) | trigger backup (POST), **delete backup** (DELETE), download (blocked GET), retain-days (PATCH), apply secrets (POST) |
| `[name]/admin` | cron, UFW firewall, cost, project settings | real | add/delete cron (POST/DELETE), add/delete UFW rule (POST/DELETE), settings save (PATCH) |
| `[name]/logs` | live log tail via SSE (**read-only GET, holds an SSH connection**) | a few seconds of real output, then close; `test-smoke` error state | — |

## Known issues found while building the guard (2026-09-22)

Logged here so they aren't lost. The audit should confirm and grade them rather
than rediscover them.

1. **Deploy fires on one click with no confirmation**, on a production-deploy
   button. The only interstitial is the disk/memory ≥80% warning. Destroy has a
   modal; Deploy doesn't.
2. **Deploy on an unreachable project leaves the button stuck on "Running…"**
   with nothing running. On `test-smoke`, the page renders its "SSH
   unreachable" branch, which doesn't mount the deploy panel, so the click sets
   `deploying` with no request and no way to see or clear it.
3. **One Deploy click sent the POST twice** in the guard proof (probably React
   dev-mode double-mount of the deploy panel's stream). The API rejects a
   concurrent deploy with 409, so the duplicate is likely harmless, but it's
   worth confirming the stream isn't started from an effect that runs twice.
