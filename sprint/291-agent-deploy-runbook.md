# Document the agent-deploy workflow and prove it end to end
**Difficulty:** 2

## Goal
`docs/PRE-PUSH-HOOK.md` stops telling operators never to deploy from an agent
shell — which is now wrong — and instead documents the supported detached path,
the durability declaration, and how to resume watching a deploy whose session
went away. One real deploy through that path proves it works.

## Reason
Sprint 282 added an operator warning, and sprint 287 expanded it into full
guidance, both saying a production deploy must not be launched from an
environment that can tear the process down — naming agent background shells
explicitly. That was correct at the time. Sprints 289 and 290 changed it: there
is now a supported, durable way to deploy from exactly those shells, and it is
the operator's primary workflow.

Documentation that actively tells you not to do the thing the tooling now
supports is worse than no documentation, because it is trusted under pressure.
The runbook is what someone reads at 2am when the dashboard looks stuck; it has
to describe the system that exists.

One verification note worth recording rather than acting on: sprints 282 and 283
each deferred live-push verification, and both were finally exercised by a real
emit-social deploy on 2026-08-20 — but that push came from a **real terminal**,
so the detached agent path has still never run a real production deploy. Sprint
289's kill-the-launcher test proves survival against a bare remote, which is the
substantive proof; a production run is confirmation, not evidence. This sprint
writes the checklist for that confirmation and leaves the timing to the
operator.

## Context
- `docs/PRE-PUSH-HOOK.md` is the runbook. It was already ~492 lines before
  sprint 288 and is now ~545 — over the project's 300-line guideline. A
  backlog item already proposes splitting it by section. **Do not do that split
  here**; this sprint corrects content only, and adding a large new section to
  an oversized file should be noted as a follow-up rather than silently
  worsened.
- `docs/DEPLOYMENT-PITFALLS.md` holds the 2026-08-19 incident write-up from
  sprint 287. The agent-deploy story is a natural addendum there: the incident
  motivated the gate, and the gate then blocked the primary workflow. Read both
  files and put each part where it fits rather than duplicating.
- Statements in the existing docs that are now **wrong** and must be corrected,
  not merely appended to:
  - the sprint-282 operator warning subsection
  - sprint 287's "don't deploy from a teardown-prone environment" guidance
  - anything naming `EMIT_ALLOW_UNATTENDED_DEPLOY` as the way past the gate
    (sprint 290 deprecates it in favor of the durability declaration)
- Facts to document, all verified:
  - Durability cannot be auto-detected on macOS/bash 3.2: bash does not expose
    an inherited ignored `SIGHUP`, `setsid` is absent, and `nohup cmd &` leaves
    `pgid` unchanged. The declaration is a contract with the caller, not a proof.
  - The hook deploys **before** `git push` completes, which is why prod and
    `main` move together — and why the fix detaches the whole push rather than
    just the deploy phase.
  - Recovery vocabulary already documented in 287: `deploying`, `deployed`,
    `failed`, `interrupted`, `orphaned`, plus the classifier's
    running/orphaned/unknown states.
- **Run this sprint last.** It documents what 289 and 290 actually built. If
  either changed shape during execution, follow the code, not this file.

## Tasks
1. Correct the now-wrong guidance in `docs/PRE-PUSH-HOOK.md`. The rule is no
   longer "never deploy from an agent shell" — it is "never deploy from a shell
   whose lifetime is tied to a single tool call; use the detached path, which
   survives it."
2. Document the supported workflow: `scripts/deploy-detached.sh`, the `/deploy`
   skill, what the durability declaration asserts and who is responsible for it
   being true, and the fact that the gate cannot verify the claim.
3. Document resuming: a deploy whose launching session went away is still
   running. Cover the predictable log path, `--watch`, `emit-infra status`'s
   local pipeline section, and when to reach for `emit-infra reconcile --write`.
4. Document the launch-mode field sprint 290 added to the status records, and
   how to read it in a post-mortem.
5. Add the agent-deploy addendum to `docs/DEPLOYMENT-PITFALLS.md`: the gate from
   288 blocked the primary workflow, why a blanket override was rejected, and
   why detaching the whole push was the fix.
6. Write the verification checklist an operator should run at the **next
   natural deploy** through the detached path: push lands, `origin/main` moves,
   terminal `deployed` record carries the detached launch mode, no stray
   heartbeat process survives, deployed build healthy. Do **not** trigger a
   production deploy to satisfy this sprint — see Out of scope.
7. Cross-check every command, flag, and env var in the new docs against the code
   as it exists after 289 and 290 — a stale flag name in this file is worse than
   no doc.
8. Note the `docs/PRE-PUSH-HOOK.md` size problem as a follow-up rather than
   splitting it here.

## Files involved
- `docs/PRE-PUSH-HOOK.md` — correct the stale guidance; document the detached
  path, the declaration, resuming, and the launch-mode field
- `docs/DEPLOYMENT-PITFALLS.md` — the agent-deploy addendum

## Acceptance criteria
- [ ] No remaining statement in either doc tells the operator not to deploy from
      an agent shell without naming the supported detached path
- [ ] The detached workflow is documented end to end: launch, resume a deploy
      whose session went away, and recover an orphaned record
- [ ] The "cannot auto-detect durability" finding is recorded with its evidence,
      so a later sprint doesn't retry `SIGHUP` / `setsid` / `pgid` heuristics
- [ ] `EMIT_ALLOW_UNATTENDED_DEPLOY` is described as deprecated wherever it
      appears, pointing at sprint 290's replacement
- [ ] Every command, flag, and env var in the new docs is verified against the
      code as it exists after sprints 289–290
- [ ] A verification checklist for the next natural detached deploy is written
      into the runbook (remote sha, terminal record, launch mode, health)
- [ ] Markdown lints clean if the repo lints markdown

## Out of scope
- **Any code change.** If writing the docs exposes behavior that is wrong rather
  than merely undocumented, file a follow-up sprint instead of fixing it here.
- **Triggering a real production deploy.** A live push to a wired project's
  `main` is an irreversible, outward-facing action that a headless session
  cannot authorize for itself — as an acceptance criterion it stalls every
  unattended run of this sprint (observed on sprint 282, 2026-08-19). Sprint
  289's kill-the-launcher test is the automated proof; production confirmation
  happens at the operator's next natural deploy using the checklist from task 6.
  Do not re-add this as a criterion.
- Splitting `docs/PRE-PUSH-HOOK.md` by section, despite it being over the
  300-line guideline. That's a separate, already-filed backlog item.
- Documenting the wider deploy architecture (terraform, ansible, blue-green
  mechanics) beyond what this runbook needs.
- Any develemit-hq dashboard change to surface the new launch-mode field.
