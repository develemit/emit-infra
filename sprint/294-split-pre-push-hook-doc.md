# Split docs/PRE-PUSH-HOOK.md into focused sections
**Difficulty:** 2

> _Promoted from backlog: sprint-273, sprint-288, and sprint-291 follow-ups, 2026-08-21._

## Goal
`docs/PRE-PUSH-HOOK.md` is broken into focused documents each under the ~300-line
guideline, with the entry point still answering "what happens when I push?"
without the reader hunting.

## Reason
Three separate sprints have now filed the same follow-up. The file was 332 lines
at sprint 273, ~545 at 288, ~684 at 291, and is **703 lines today**. Each sprint
declined to split it — correctly, since each was adding real content and a
restructure mid-sprint would have buried the change — but the deferral has
compounded three times.

This is the document someone reads under pressure when a deploy looks stuck. At
703 lines, the recovery runbook is buried behind build-cache internals and a
cross-platform Dockerfile pattern. Length is now a usability problem, not just a
guideline violation.

## Context
- The file has accumulated in layers. Read the existing headings first
  (`grep -n '^#' docs/PRE-PUSH-HOOK.md`) and split along the seams already there
  rather than inventing a new taxonomy.
- Roughly four natural clusters, from the backlog's own suggestion: **gates**
  (dry-run, ignored paths, the unattended-shell gate), **signals and liveness**
  (traps, heartbeat, status vocabulary, orphan recovery, reconcile),
  **build internals** (smart build, build cache, diagnosing slow deploys), and
  the **cross-platform build pattern**.
- `docs/DEPLOYMENT-PITFALLS.md` already exists and holds incident write-ups —
  don't duplicate into it; cross-link instead.
- Content added by sprints 282, 287, 288, 290, 291, and 292 is current and
  correct. **This sprint moves text; it does not rewrite it.** If you find
  something factually wrong while moving it, file a follow-up rather than
  fixing it inline, so the diff stays reviewable as a pure move.
- Things that link here and must not break: `scripts/hooks/pre-push`'s refusal
  message, `scripts/deploy-detached.sh`, `README.md`, and several sprint files.
  Grep for `PRE-PUSH-HOOK` across the repo before renaming anything.

## Tasks
1. Inventory the current headings and map each to a target document.
2. Split into focused files under `docs/` — keep `docs/PRE-PUSH-HOOK.md` as the
   entry point with an overview plus links, so existing references stay valid.
3. Move text verbatim. Adjust only headings, links, and connective sentences.
4. Make sure the recovery runbook (orphaned deploys, `emit-infra reconcile`,
   confirming what shipped) is reachable within one hop of the entry point —
   it's the highest-pressure path.
5. Update every in-repo reference found by grep, including the refusal message
   in `scripts/hooks/pre-push` if it names a section.
6. Confirm each resulting file is under ~300 lines; if one isn't, split further
   or say why it can't be.

## Files involved
- `docs/PRE-PUSH-HOOK.md` — becomes the entry point
- new files: `docs/` siblings, one per cluster (name them after the clusters you
  settle on in task 1)
- `scripts/hooks/pre-push`, `scripts/deploy-detached.sh`, `README.md` — update
  references only if they name a section that moved

## Acceptance criteria
- [ ] Every resulting doc is under ~300 lines, or the exception is justified in
      the file itself
- [ ] `docs/PRE-PUSH-HOOK.md` still answers "what happens when I push to main?"
      without following a link
- [ ] The recovery runbook is at most one hop from the entry point
- [ ] No in-repo reference to a moved section is left dangling — verified by grep
- [ ] The diff is a pure move: no factual content changed (anything wrong found
      while moving is filed as a follow-up instead)
- [ ] Markdown lints clean if the repo lints markdown

## Out of scope
- **Any code change.** Docs only.
- Rewriting or correcting content. Move it; file follow-ups for anything wrong.
- `docs/DEPLOY-FLOOR.md`, which the backlog explicitly holds as a deliberate
  chronological log that splitting would damage.
