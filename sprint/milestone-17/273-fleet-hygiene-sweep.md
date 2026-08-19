# Sprint 273 — Fleet hygiene sweep: small accumulated cleanups

> _Promoted from sprint 252/256/262/263/264/266/268 follow-ups, 2026-08-02._

## Goal
Clear the pile of small, verified-low-risk cleanups accumulated during the
252–268 initiative — each too small for its own sprint, together worth one
pass. Every item below is either done or explicitly re-deferred with a reason.

## Context & task list (one commit per repo touched)
1. **tastease server:** `martialops.conf` sits unsymlinked in
   `sites-available/` (confirmed inert, sprint 262) — archive it off the
   live path (move to a dated `*.retired` name or remove after confirming
   with `nginx -t` that nothing references it).
2. **emit-vision repo:** `provision-list/summary.md` line ~30 still claims
   `healthchecks.io (DMS) | ✅ Complete | dms-ping live` — align with the
   rewritten `healthchecks-io.md` (deferred 2026-08-01, superseded by the
   self-hosted-DMS discovery item).
3. **emit-vision repo:** check whether `apps/extension` (depends on `sharp`)
   ships as a Docker image at all; if yes, note it needs the native-build
   pattern; if no, record that and move on.
4. **martialops:** its apex domain doesn't resolve and its one resolving
   hostname presents a mismatched SSH key (sprint 264) — investigate
   DNS/server records read-only; report findings, fix only obvious staleness
   (e.g. a dead A record), nothing invasive.
5. **This Mac:** sweep stale `nx run *:dev` orphan processes across projects
   (sprint 256 found several days-old ones); kill confirmed-stale ones and
   note counts. Do not kill anything belonging to a live dashboard PTY.
6. **develemail:** silence the two cosmetic per-invocation warnings — the
   `.npmrc` `${NPM_TOKEN}` read warning (guard or default the var) and the
   `nx configure-ai-agents` nag (run the configure or suppress per nx docs)
   — only if each fix is genuinely trivial; otherwise re-defer with reason.
7. **emit-infra docs:** fold tastease's `migrate`-stage restructuring
   (sprint 268) into `docs/PRE-PUSH-HOOK.md`'s native-module-trap section as
   the second confirmed example.

## Acceptance criteria
- [x] Each numbered item: done (with evidence in completion notes) or
      re-deferred with a stated reason — none silently skipped
- [x] `nginx -t` clean on tastease after item 1; no prod service disturbed
- [x] Each touched repo's own CI green on its commit
- [x] emit-infra `pnpm test:hooks` + typecheck/lint/test green

## Completed

**Date:** 2026-08-02

### Summary
Worked all 7 items. Item 1 (tastease nginx) and item 5 (process sweep) were
server-/machine-local operations with no repo commit; items 2, 6, and 7
produced one commit each in their respective repos; item 3 was an
investigation with a negative result (nothing to change); item 4 was a
read-only DNS investigation per this run's standing authorization, re-deferred
with a concrete reason.

Item 5 (stale dev-process sweep) turned out much bigger than the sprint's
"several days-old ones" framing suggested: 13 orphaned `nx`/`pnpm dev`
process trees (56 pids total) had accumulated across four projects, the
oldest 30 days old. All were confirmed orphaned (reparented to `launchd`,
i.e. their spawning shell/PTY was long gone) *and* confirmed to hold no
listening socket anywhere in their descendant tree (verified via `lsof`
before touching anything) — i.e. genuinely serving nothing, not just old.
Three other old-but-*actively-listening* dev servers were deliberately left
running (see below) since "listening" is the operative signal for "might be
live," not age. First `kill -TERM`/`-KILL` attempts silently no-op'd
(exit 0, process survived) — root cause was zsh's default no-word-splitting
on an unquoted `$PIDS` variable in a `for` loop, not a sandbox restriction;
switching to a bash array (`"${PIDS[@]}"`) fixed it immediately.

Item 6's `nx configure-ai-agents` run turned out to actually execute (a
`--help` flag isn't recognized by that subcommand, so it ran the default
configure action) — reviewed the resulting `CLAUDE.md` diff before keeping
it: a one-line heading-level change inside the tool's own auto-managed
block, harmless.

### Per-item detail

**1. tastease server — `martialops.conf`.** Confirmed via `ls
/etc/nginx/sites-enabled/` that it was never symlinked in (matches sprint
262). Renamed to `martialops.conf.retired-2026-08-02` on the server via SSH.
`nginx -t` → syntax ok, test successful; `systemctl status nginx` showed the
service undisturbed (already `active (running)` since before this change, no
reload triggered). No local repo file referenced it, so no commit needed.

**2. emit-vision — `provision-list/summary.md`.** Updated the healthchecks.io
row from `✅ Complete — dms-ping live` to `🪦 Deferred — never provisioned;
user deferred 2026-08-01, superseded by self-hosted DMS discovery item`,
matching `healthchecks-io.md`'s rewritten status. Adjusted the overview
count (13 complete → 12 complete + 1 deferred) since exactly one row's status
changed. Committed `1c9cfc6`.

**3. emit-vision — `apps/extension`.** Confirmed via `find` (no
`apps/extension/Dockerfile`) and `grep` (no `extension` reference in any of
the 7 compose files under `docker-compose*.yml`/`infra/docker/*.yml`) that it
does not ship as a Docker image at all, despite depending on `sharp`
(devDependency, presumably build-time icon generation for the extension
bundle). The native-build pattern from sprint 266 doesn't apply — nothing to
convert. No file changes; this finding is the record. `backlog.md`'s
sprint-266 follow-up entry already links here.

**4. martialops DNS — read-only per this run's standing authorization.**
`dig martialops.app` → NS records only (Cloudflare), no A/AAAA — nothing for
the apex to point at. `dig www.martialops.app` → `178.156.218.94`. Compared
`known_hosts` against a fresh `ssh-keyscan` of that IP (read-only, no
`known_hosts` mutation): all three host-key types (ed25519/rsa/ecdsa) differ
from what's on file, confirming sprint 264's finding that the IP has been
reassigned to an unrelated party, not martialops's own server. `whois`
confirms the IP is still Hetzner-owned (`DE-HETZNER-20100602`). Cross-checked
against the actual Hetzner account (`hcloud server list`): only 5 servers
exist (emit-vision-prod, diner-decider, tastease, develemail, emit-social) —
**no martialops server exists in the account at all**, matching
emit-billing's precedent (never provisioned). Re-deferred: there's no live
server to point DNS at, and deleting the stale `www` A record vs.
provisioning a real one is a product decision outside a hygiene sprint's
scope — plus this run's standing authorization was explicit that martialops
DNS stays read-only regardless. No changes made.

**5. This Mac — stale dev-process sweep.** See Summary above for the
headline numbers. Full accounting:
- **Killed (13 trees / 56 pids, all orphaned + zero listening sockets):**
  emit-infra ×2 (`api:dev` trees, 10.5h and 4d16h old), tastease ×7 (`pnpm
  dev` → `api` tsx-watch trees, 4d16h–19d23h old — the `web`/`next-dev` half
  of each tree had already died on its own, leaving a zombie `api` half that
  could never bind its port since a still-live tree already held it), develemail
  ×3 (`api:dev` trees, all ~30 days old), emit-vision ×1 (`worker:dev` tree,
  7.5 days old).
- **Left running (3, all actively listening, deliberately not touched):**
  tastease's current dev tree (port 3211, <1 day old — the live one),
  tastease `apps/api` tsx-watch on port 3333 (pid 93654, **29 days old** but
  still the one genuinely serving — it's what all 7 killed tastease zombies
  failed to displace since it already held the port), and a tastease
  `.next/standalone` `next-server` on port 3000 (pid 87012, **21 days old**,
  still listening). The latter two are flagged here for the user's awareness
  rather than acted on — old but functioning, and killing something
  currently serving wasn't this item's mandate.
- No repo commit (not git-tracked state).

**6. develemail — cosmetic warnings.** Both were genuinely trivial:
  - `.npmrc`'s `//registry.npmjs.org/:_authToken=${NPM_TOKEN}` warned on
    *every* pnpm invocation (`pnpm --version` alone reproduced it) because
    `NPM_TOKEN` is referenced nowhere else in the repo — not in any
    Dockerfile (`grep` across all 4 confirmed no `ARG NPM_TOKEN`), CI
    workflow, or emit-infra's deploy tooling. Confirmed dead config (added
    sprint-era commit `599b1dd` swapping a hardcoded token for an env-var
    reference that was never actually wired up anywhere) — removed the line
    entirely rather than working around it.
  - `nx configure-ai-agents` — running it (see Summary) refreshed the
    auto-managed Nx block in `CLAUDE.md` (heading level only) and cleared
    the "AI agent configuration is outdated" nag.
  - Committed together: `91997dd`.

**7. emit-infra docs — `PRE-PUSH-HOOK.md`.** Added a new paragraph after the
existing "untaxed path" example documenting both confirmed instances of the
native-module trap's two sub-cases: diner-decider's `sharp` case (sprint
267, ships-to-runtime) and tastease's `migrate`-stage case (sprint 268,
build-adjacent — `FROM builder AS migrate` silently inheriting the native
`$BUILDPLATFORM`, with the crash only surfacing at container *start* on the
server, not at build time). Committed `f02eb8d`.

### Files changed
- (tastease server, not repo-tracked) `/etc/nginx/sites-available/martialops.conf`
  → renamed to `martialops.conf.retired-2026-08-02`
- `~/projects/emit-vision/provision-list/summary.md` — healthchecks.io row +
  overview counts aligned with its deferred status
- `~/projects/develemail/.npmrc` — removed dead `NPM_TOKEN` authToken line
- `~/projects/develemail/CLAUDE.md` — `nx configure-ai-agents` refresh
  (auto-managed block, heading level only)
- `~/projects/emit-infra/docs/PRE-PUSH-HOOK.md` — native-module-trap
  section: added tastease's confirmed build-adjacent example alongside
  diner-decider's ships-to-runtime example

### Verification
- tastease `nginx -t`: syntax ok, test successful; nginx service undisturbed
- emit-vision commit `1c9cfc6`: pre-commit (lint/typecheck/check-tokens) —
  all checks passed
- develemail commit `91997dd`: pre-commit (lint/typecheck/test on affected)
  — all checks passed; `pnpm --version` re-run post-fix confirmed the
  `.npmrc` warning is gone
- emit-infra commit `f02eb8d`: pre-commit passed
- emit-infra `pnpm test:hooks`: 47/47 passed
- emit-infra `pnpm exec nx run-many -t typecheck lint test`: 5/5 projects
  green, 350/350 tests passed (11/14 tasks served from cache — expected,
  only docs changed)
- Process sweep: re-verified post-kill that all 56 target pids are gone
  (`ps -o pid -p ...` empty) and that the 3 intentionally-spared listening
  processes (ports 3211/3333/3000) are still alive and still listening

### Follow-ups
- `[defer]` `docs/PRE-PUSH-HOOK.md` was already 311 lines (over the 300-line
  target) before this sprint's 21-line addition brought it to 332. Splitting
  it was out of scope for a hygiene sprint touching 4 other repos — worth
  doing the next time that doc is substantively touched.
- `[defer]` tastease `apps/api` tsx-watch on port 3333 (pid 93654, 29 days
  old) and a `.next/standalone` `next-server` on port 3000 (pid 87012, 21
  days old) are still running locally, both actively listening/functioning
  but unusually long-lived for local dev processes. Not killed (still
  serving), but worth the user's attention — restarting a fresh `pnpm dev`
  session for tastease would replace both cleanly.
- `[defer]` martialops has no server in the Hetzner account at all (not just
  unreachable — never provisioned, or fully deprovisioned). The stale
  `www.martialops.app` A record pointing at a reassigned Hetzner IP is a
  genuine dead record, but fixing it (delete vs. point at a newly-provisioned
  server) is a product decision, not a hygiene fix — same status as
  emit-billing.
- none other
