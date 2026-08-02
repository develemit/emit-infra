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
- [ ] Each numbered item: done (with evidence in completion notes) or
      re-deferred with a stated reason — none silently skipped
- [ ] `nginx -t` clean on tastease after item 1; no prod service disturbed
- [ ] Each touched repo's own CI green on its commit
- [ ] emit-infra `pnpm test:hooks` + typecheck/lint/test green
