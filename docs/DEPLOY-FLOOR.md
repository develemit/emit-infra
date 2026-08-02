# Deploy floor: where the ~200s server-side phase goes

Sprint 253 findings. Measured on develemail (production), using the
`ansible.posix.profile_tasks` + `timer` callbacks enabled in
`packages/core/src/ansible.ts` (sprint 253). Sprint 254 optimizes based on
this data — this doc doesn't fix anything, it measures.

## Method

Three real production deploys, same instrumentation, all against
`ansible/roles/app-deploy` (blue-green deploy path):

| Run | SHA | Type | `deploy` phase (hook) | Playbook self-reported |
|---|---|---|---|---|
| 1 | `775404d` | retag-only (floor) | 249s | 247s (4:07) |
| 2 | `cb9fb28` | with-build (api) | 241s | 239s (3:59) |
| 3 | `89904ee` | with-build (api) | 243s | 241s (4:01) |

Run 1 forced a retag-only push (`EMIT_FORCE_DEPLOY=1`) with no service
changes — 100% server-side/Ansible overhead, nothing to build. Runs 2–3
touched `apps/api/src/main.ts` (one-line comment, added then reverted) to
force a real `api` image build, giving a with-build comparison point.

**Building a new image adds ~0 to the deploy phase.** All three runs land
within an 8s band (239–247s). The `build` phase (74s, 70s) is separate and
already reported by the sprint-252 hook timing — it does not touch the
Ansible-measured deploy phase at all, confirming the two phases (CI/build vs.
server-side apply) are cleanly separated and build time is not hiding inside
the "deploy" number.

## Top tasks (avg of 3 runs, ranked by cost)

| Rank | Task | Avg duration | % of playbook total |
|---|---|---|---|
| 1 | Copy extra files (opendkim/postfix configs, looped) | **60.35s** | ~25% |
| 2 | Run blue-green deploy script | **25.60s** | ~11% |
| 3 | Copy blue-green compose files | **16.93s** | ~7% |
| 4 | Copy .env file | 11.72s | ~5% |
| 5 | Write deployed version file | 11.69s | ~5% |
| 6 | Copy docker-compose file | 8.76s | ~4% |
| 7 | Copy health-check script | 8.84s | ~4% |
| 8 | Copy health-check-all script | 8.65s | ~4% |
| 9 | Copy nginx vhost from repo | 8.02s | ~3% |
| 10 | Copy blue-green deploy script | 7.62s | ~3% |

The 20 tasks `profile_tasks` reports (its default top-N) sum to ~234s of the
247s playbook total for run 1 — roughly 95% of wall time is accounted for by
named tasks; the remainder is connection setup / gather-facts / task
dispatch overhead not attributed to a single task.

Full per-task breakdown for all three runs is preserved in develemail's
`.deploy-logs/<sha>.log` (SHAs above) — profile_tasks output is captured
automatically on every deploy going forward, no manual flags needed.

## Top 3 contributors to the ~200s floor, with numbers

1. **"Copy extra files" — 60.35s avg, the single largest task by ~2.4x.**
   This is one Ansible task looping over 7 small config files (opendkim
   conf/hosts/entrypoint, postfix main.cf/master.cf/log-to-file.conf/
   logrotate.conf) via the `copy` module. Each loop iteration is effectively
   its own remote operation (stat + checksum + transfer) — with no SSH
   pipelining configured (`ANSIBLE_SSH_PIPELINING` unset), each incurs full
   connection/checksum overhead rather than reusing one session. 7 files ×
   ~8-9s each lines up with the totals seen for the *other* single-file copy
   tasks in this table (Copy docker-compose file: 8.76s, Copy health-check
   script: 8.84s) — strong signal this is per-file SSH/SFTP overhead, not
   file size (all 7 files are small text configs).

2. **"Run blue-green deploy script" — 25.60s avg, consistent across all 3
   runs (25.52 / 25.61 / 25.67s — <1% variance).** This task's own duration
   is opaque to Ansible: it shells out to `blue-green-deploy.sh`, which
   internally pulls images, starts the new slot, health-checks (observed:
   web healthy on attempt 2, api on attempt 1 — with a 5s poll interval that
   alone is ~5-10s of the 25s), switches nginx, stops the old slot, and
   prunes. The near-zero variance between a retag-only run and two
   with-build runs suggests image pull is cheap here (small images / already
   cached layers) and the health-check polling dominates this task — but
   this is inference, not measurement; the script has no internal timing.
   **Not instrumented this sprint** — `ansible/roles/app-deploy/files/
   blue-green-deploy.sh` is a shared script copied to every emit-infra
   project's server, and adding timestamps was judged out of scope for a
   measurement-only sprint given that blast radius. Sprint 254 should add
   `date +%s` markers around steps 1 (pull), 3 (start), 4 (health check), 5
   (nginx switch), and 9 (stop old) before touching anything else in this
   task.

3. **"Copy blue-green compose files" — 16.93s avg** for 2 files
   (`docker-compose.blue.yml`, `docker-compose.green.yml`). Same shape as
   finding #1: ~8.5s/file, consistent with per-file SSH overhead rather than
   content size.

Together, these 3 tasks (out of ~25 in the role) account for **~103s of the
~240-250s floor — over 40%** — and two of the three (#1, #3) are the same
underlying cost repeated: per-file copy overhead with no connection reuse.

## Ranked hypothesis list for sprint 254

1. **Batch the small-file copies (highest confidence, highest leverage).**
   Tasks 1, 3, and several of the single-file copies (docker-compose,
   health-check scripts, nginx vhost) are all `copy`/loop operations paying
   full per-file SSH overhead. Enabling `ANSIBLE_SSH_PIPELINING=True` (or
   `pipelining = True` under `[ssh_connection]`) is the standard fix and
   should cut most of these — Ansible's own docs cite this as the top lever
   for many-small-file transfers. Alternative/complementary: bundle the
   opendkim+postfix configs into a single `synchronize` (rsync) call instead
   of a `copy` loop.
2. **Instrument `blue-green-deploy.sh` internally (medium confidence,
   second-highest single-task cost).** 25.6s is opaque; likely dominated by
   the health-check poll loop (fixed 5s interval, non-configurable per
   attempt) rather than actual work. If so, lowering `HEALTH_INTERVAL` or
   switching to a shorter first-attempt delay would help. Needs the
   `date +%s` markers noted above to confirm before changing anything —
   this script is shared across projects, so any change needs its own
   verification pass.
3. **Re-examine whether every task needs to run on every deploy.** Several
   tasks (compose files, health-check scripts, nginx vhost) rarely change
   between deploys but are copied unconditionally every time. An
   Ansible `changed_when`/checksum-skip (or moving to `template` with proper
   idempotency) wouldn't reduce *this* run's cost (copy still stats the
   remote file) but pairs well with pipelining.

## Other observations

- **The 1500s outlier** (`.deploy-history.jsonl`) was not reproduced or
  investigated — out of scope per this sprint's instructions. No evidence
  was found or looked for beyond confirming it exists in history.
- **No config changes were made to make measurement reliable** — the
  `ANSIBLE_CALLBACKS_ENABLED` env var was sufficient with the existing
  `ansible.posix` collection (already installed; no `ansible.cfg` exists at
  repo root and none was added — env-var injection matches how
  `runAnsible` already passes `ANSIBLE_HOST_KEY_CHECKING`).
- **Deploy behavior was unaffected.** All 3 measurement deploys completed
  successfully; `.deploy-status.json` ended `deployed` after each.

## Sprint 254 results: after numbers

Implemented hypothesis #1 (SSH pipelining + ControlPersist) and #2
(`blue-green-deploy.sh` internal timing markers) from above, plus made the
trailing dangling-image prune fire-and-forget (`async`/`poll: 0`). Measured
with the same instrumentation, on the same host, against `ci.envFile` /
`.deploy-history.jsonl` `phases.deploy` (the hook-measured deploy phase,
which includes a small wrapper overhead over the playbook's own self-report):

| Run | SHA | Type | `deploy` phase (hook) | Playbook self-reported |
|---|---|---|---|---|
| 1 | `7d01411` | retag-only (floor) | 118s | 114.6s (1:54.6) |
| 2 | `2c43bd4` | with-build (api) | 126s | 122.8s (2:02.8) |
| 3 | `2209cb1` | with-build (api, revert) | 123s | 119.3s (1:59.3) |

**Retag-only floor: 249s → 118s, a 52.6% reduction.** With-build: 241–243s →
123–126s, a ~48% reduction. **This does not clear the <90s acceptance
target** — the closest run (retag-only) is 28s over.

A second project (`tastease`, `composeStructure: profiles` — a different
code path through `blue-green-deploy.sh`'s `compose_cmd_*` branching than
develemail's `separate` structure) deployed cleanly with the same changes:
deploy phase 99s, correct `blue → green` switch, health-gated (api healthy
on attempt 2), pre-deploy migration ran, old slot stopped. No regression in
either `composeStructure` mode.

### Where the remaining ~115-120s goes (from the retag-only run's per-task recap)

| Rank | Task | Duration | vs. sprint 253 baseline |
|---|---|---|---|
| 1 | Copy extra files (7-item loop) | 25–28s | 60.35s (−~55%) |
| 2 | Run blue-green deploy script | 20–22s | 25.60s (−~15-20%) |
| 3 | Copy blue-green compose files | 6.5–8.8s | 16.93s (−~55%) |
| — | Remove dangling images (async dispatch) | 6–7s | not separately profiled before |
| — | Write deployed version file | 5.5–7s | 11.69s (−~45%) |
| — | Copy .env file | 5.5–6s | 11.72s (−~50%) |

Pipelining cut every per-file copy task roughly in half, but did **not**
eliminate them — each still pays a fixed per-task cost (remote Python
module dispatch + checksum stat), independent of the SSH connection reuse
pipelining provides. With ~20 tasks in the critical path at ~1-8s each,
this fixed per-task floor is now the dominant remaining cost, not raw SSH
overhead.

The new timing markers broke open task #2 (previously fully opaque):
`pull` 2-5s, `start` 1-2s, `health_check` 5s, `nginx_switch` 0s,
**`stop_old` 11s on develemail / 1s on tastease**. 11s lines up almost
exactly with Docker's default 10s `stop` grace period — develemail's old
slot apparently doesn't exit promptly on `SIGTERM`. This is a real,
data-backed lever (shortening the old slot's stop timeout via `docker
compose stop -t N`) but **was deliberately not pulled this sprint**: the
old slot's `worker` service may have an in-flight job when stopped, and a
shorter grace period trades deploy speed for a small, per-deploy risk of
killing that job mid-work. That tradeoff needs verification of the
worker's actual shutdown behavior, not a blind timeout cut on a role shared
by every project on the pipeline.

**Why the <90s target wasn't fully pursued:** the next-biggest lever
(shrinking "Copy extra files" further) was investigated and rejected for
develemail specifically. `infra/opendkim/` also contains `key.table` and
`signing.table`, which `infra/opendkim/entrypoint.sh` documents as written
at runtime by the live API container when domains are created/verified —
consolidating that directory into a single recursive `copy` (as hypothesis
#3 above suggests) would silently overwrite those with stale checked-in
repo copies on every deploy, breaking DKIM for any domain added since the
last commit. `infra/postfix/` has no such landmine (its 4 files are exactly
develemail's 4 `extraFiles` entries, 1:1) and could safely collapse to one
directory-copy task — worth ~10-15s — but that's a develemail-config-only
change (`extraFiles` is plain per-project JSON, not shared role code; no
other project has more than 1 entry) outside this sprint's file list, and
the projected gain still wouldn't clear 90s on its own. Filed as a
follow-up rather than rushed.

## Sprint 265 results: postfix directory copy + stop_old fix

Landed both follow-ups sprint 254 deliberately deferred, each measured with
its own retag-only develemail deploy against the same `.deploy-history.jsonl`
`phases.deploy` metric, plus a with-build deploy and a tastease deploy to
confirm no regression.

| Run | SHA | Type | `deploy` phase (hook) | Change |
|---|---|---|---|---|
| baseline | `d4645fc8` | retag-only | 121s | (pre-sprint-265, matches sprint 254's 118s within noise) |
| 1 | `216a33d1` | retag-only | 117s | postfix directory copy only |
| 2 | `bc9161e2` | with-build (api, inbound) | 125s | + stop_old fix (but stopped the *old*, pre-fix slot — see below) |
| 3 | `99d20771` | retag-only | 109s | both changes, old slot now running fixed code |
| 4 | `8d898102` | retag-only | 107s | both changes, second measurement |

**Retag-only floor: ~119s avg → ~108s avg, roughly a 9-11s (8-9%) reduction.**
**This does not clear the ≤100s acceptance target** — the closest run (107s)
is 7s over. Below is why each change landed smaller than hoped, measured
rather than assumed.

### Optimization 1 — postfix directory copy: smaller gain than expected

Collapsing develemail's 4 `infra/postfix/` file entries into one
directory-mode `copy` task (`dir: true` on the `extraFiles` entry — see
`packages/types/src/project-config.ts` and the "Copy extra directories" task
in `ansible/roles/app-deploy/tasks/main.yml`) cut the task-level cost from
~25-28s (7-item loop, opendkim + postfix combined) to 9.93s (3-item opendkim
loop) + 12.67s (1-item postfix directory task) = 22.6s on the first
measurement — only a ~3-5s win, not the ~10-15s projected in sprint 254's
notes.

The projection was calibrated against sprint 253's *pre-pipelining* per-file
costs (~8-9s/file). Sprint 254 already enabled SSH pipelining +
ControlPersist, which cut per-file copy cost roughly in half by reusing the
connection — so most of the per-file overhead this optimization targeted was
already gone before this sprint started. What's left is fixed per-*task*
dispatch overhead (remote Python module bootstrap + checksum stat), and
collapsing 4 loop iterations into 1 only removes 3 of those, not 4 full
file-transfers' worth of cost. Later runs (12.14s, 11.09s for the directory
task alone) show enough run-to-run SSH/network variance that this
optimization's contribution is real but noisy — on the order of a few
seconds, not double digits.

`infra/opendkim/` was intentionally left untouched (per sprint 254's
landmine warning: `key.table`/`signing.table` are written at runtime by the
live API container; a directory copy would clobber them). Diff confirms no
opendkim-related file changed.

### Optimization 2 — stop_old: worker was not the culprit

Sprint 254 flagged `worker` as the "prime suspect" for the 11s `stop_old`
cost (a queue consumer, plausible in-flight-job risk). This sprint verified
that directly instead of assuming it: brought up develemail's inactive
(green) slot standalone via `docker compose -f docker-compose.prod.yml -f
docker-compose.green.yml up -d` — non-serving, since nginx still pointed at
blue — and timed `docker stop -t 30` on each of the 4 containers
individually:

| Service | `docker stop` time |
|---|---|
| web | 0.40s |
| worker | 0.29s |
| api | 30.37s (hit the 30s test ceiling) |
| inbound | 30.33s (hit the 30s test ceiling) |

**`worker` was already fine.** `api` and `inbound` — both bare Fastify/
smtp-server processes with no `SIGTERM`/`SIGINT` handler anywhere in their
bundled `main.cjs` — ran out the full timeout every time, confirmed with a
raw `kill -TERM 1` sent directly to the container's PID 1 (still alive 9s
later). Both use the same exec-form Dockerfile `CMD`/entrypoint as `web` and
`worker`, ruling out the shell-wrapper signal-swallowing failure mode sprint
265's task list called out — this is purely a missing application-level
handler, the same pattern `worker` already had correctly.

**Fix:** `apps/api/src/lib/shutdown.ts` and `apps/inbound/src/shutdown.ts`
(develemail repo) each export `createShutdownHandler`, registered on
`SIGTERM`/`SIGINT` in their `main.ts`. Both close their server (Fastify's
`app.close()` / smtp-server's `server.close()`) and race it against a 5s
timer, force-exiting either way. The bound matters: neither server's
`close()` forces idle keep-alive connections shut on its own, so an
unbounded await could reproduce the exact same grace-period-then-SIGKILL
problem it's meant to fix. 5s leaves comfortable headroom inside Docker's
10s default `stop_grace_period`.

**In-flight-job safety:** `api` and `inbound` are stateless HTTP/SMTP request
handlers, not queue consumers — there is no persisted job state to lose.
`app.close()` / `server.close()` stop accepting new connections immediately
and let already-accepted requests finish, bounded by the 5s timer; a request
that's still running past 5s is cut off, same as today's eventual SIGKILL
would do, except now it happens deliberately at 5s instead of by accident at
10s. `worker` (the actual queue consumer, with its own `drainTimeoutMs`-based
in-flight-job handling) was untouched — it was already shutting down cleanly
and was never part of the fix.

**Measured effect:** `stop_old` went from 11s to 1s (log line `[timing]
stop_old: 1s`), confirmed on two separate retag-only deploys after the fix
was live on both slots. The with-build deploy that introduced the fix
(`bc9161e2`) still showed `stop_old: 11s`, because that deploy's *old* slot
(the one being stopped) was still running pre-fix images — blue-green always
stops the previous deploy's slot, so a fix to running code only shows up
once that slot itself has been through one deploy cycle. This is expected
and not a bug.

### Verification

- Blue/green semantics: `ansible/roles/app-deploy/files/blue-green-deploy.sh`
  has a clean diff (untouched) across this sprint — health gate, slot
  alternation, and rollback path are provably unaffected. Every deploy in
  the table above health-gated normally (`web healthy`, `api healthy`)
  before switching.
- Cross-project regression: tastease (`composeStructure: profiles`, no
  `extraFiles` configured) deployed cleanly (`ef8bf8e3`) — `extra_files` is
  entirely absent from its extra-vars, so both the file-loop and
  directory-loop Ansible tasks resolve to empty loops, a no-op. No task
  failures, correct slot switch.
- Tests: `apps/api/src/lib/shutdown.test.ts` and
  `apps/inbound/src/shutdown.test.ts` (develemail repo) cover the bounded
  shutdown logic via dependency injection (fake `close`/`exit`/`log`) —
  resolves-normally, times-out, rejects, and double-signal-is-idempotent
  cases. develemail CI (lint/typecheck/test/build) passed on every commit
  pushed this sprint. emit-infra: `pnpm test:hooks` (36/36) and
  `nx run-many -t typecheck,lint,test` (5/5 projects) green.
