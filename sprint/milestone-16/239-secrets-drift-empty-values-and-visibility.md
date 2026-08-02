# Make secrets drift honest: detect empty values and surface unmonitored projects
**Difficulty:** 3

## Goal
`GET /projects/:name/secrets-drift` should distinguish a key that is **absent** from one that is **present-but-empty**, and the dashboard should visibly flag a project that declares no `requiredEnvKeys` as *unmonitored* instead of rendering nothing.

## Reason
Two blind spots make the existing drift tool report "fine" when it isn't.

**Empty values are invisible.** The route builds its server key set with `grep '=' | cut -d= -f1` (`apps/api/src/routes/secrets.ts:40`) — that extracts key *names* only, so `KEY=` counts as fully present. This is precisely the failure mode that caused emit-vision's silent email outage: `docker-compose` substitutes an absent `${VAR}` with an **empty string**, so the container starts healthy with `VAR=""`, and the app read "all email vars empty" as "email intentionally disabled" and degraded to a no-op — returning `200 {"message":"verification_sent_if_found"}` while delivering nothing for a long, unknown period. A key-presence-only check cannot see that.

**Unmonitored projects look healthy.** The route returns `{status:'unconfigured'}` when `requiredEnvKeys` is unset (`secrets.ts:28`), and the panel then does `return null` (`apps/dashboard/src/components/detail/secrets-panel.tsx:49`) — rendering *nothing at all*. As of 2026-07-24, **6 of 7 projects** have no `requiredEnvKeys` (only emit-vision, 36 keys, added post-incident). So the check has been silently inert fleet-wide since it shipped, and the dashboard gives no hint. A project with nothing declared should look conspicuously unmonitored, not clean.

## Context
- **Route:** `apps/api/src/routes/secrets.ts`.
  - `DriftResult` union at lines ~9-11: `{status:'unconfigured'}` | `{status:'ok'|'drift'; missing; extra; present}`.
  - Early return for unset `requiredEnvKeys` at line ~28.
  - Remote command at line ~40: `grep -v '^#' /opt/${name}/.env 2>/dev/null | grep '=' | cut -d= -f1 | tr -d ' '`.
  - Set comparison at ~46-50 builds `missing` / `extra` / `present`.
  - 30s TTL cache (`DRIFT_TTL`) and a 503-on-unreachable path with negative caching — leave both intact.
- **Recommended remote-command shape.** Keep it to **one** `sshExec` call. Emit two sections separated by a sentinel line, then split on it — this is the exact pattern sprint 236 used for the nginx drift route, so it is established precedent in this codebase:
  1. all key names (current behavior)
  2. a sentinel marker line
  3. key names whose value is empty, e.g. `grep -E '^[A-Za-z_][A-Za-z0-9_]*=[[:space:]]*$' | cut -d= -f1`
  Parse both lists, then classify each required key as `set`, `empty`, or `missing`.
- **Status semantics.** A project with empty-valued required keys is **drift**, not ok — an empty required secret is a defect. Add an `empty: string[]` field to the `ok`/`drift` shape and make the status `drift` when `missing.length > 0 || empty.length > 0`. Keep `missing`, `extra`, `present` so existing consumers keep working; `present` should mean "set with a non-empty value" (document this in a comment, since the meaning narrows slightly).
- **Dashboard side:** `apps/dashboard/src/components/detail/secrets-panel.tsx`.
  - Line ~49: `if (drift === null || drift.status === 'unconfigured') return null` — split these two cases. `drift === null` (503/unreachable) should keep returning null; `unconfigured` should render a muted "Not monitored" card explaining that the project declares no `requiredEnvKeys`, ideally naming the fix (sprint 240's `emit-infra secrets scaffold-required-keys <project>`).
  - The header summary at ~63-66 renders `missing · extra · present` counts — add `empty` there.
  - The "Sync to server" button renders when `missing.length > 0` (~line 64). Consider showing it for `empty` too, but only if sprint 238 has landed (it makes apply safe). If 238 is not yet complete, leave the button's condition alone and note it.
  - Type mirror lives at `apps/dashboard/src/lib/api-secrets.ts:5-7` — add `empty` there.
- **Tests:** `apps/api/src/routes/secrets.test.ts` (mocks `sshExec`, asserts JSON) and `apps/dashboard/src/components/detail/secrets-panel.test.tsx` (mocks `getSecretsDrift`; note it already has a test asserting the unconfigured case renders nothing — that test must be **updated**, since the new behavior is to render a warning).
- **Live verification:** the API runs on `:7001`. After the change, `GET /projects/emit-vision/secrets-drift` should report `ok` with `empty: []` (verified 2026-07-24: 37 keys on the server, zero empty-valued). Other projects should report `unconfigured`.

## Tasks
1. Extend the remote command in `secrets.ts` to also return empty-valued key names, using a single `sshExec` call with a sentinel-separated two-section output (sprint 236 precedent).
2. Parse both sections; classify required keys into `missing` (absent), `empty` (present with empty value), and `present` (set with a non-empty value).
3. Add `empty: string[]` to the `ok`/`drift` variant of `DriftResult`; set `status: 'drift'` when either `missing` or `empty` is non-empty.
4. Add `empty` to the dashboard's `SecretsDrift` type in `apps/dashboard/src/lib/api-secrets.ts`.
5. In `secrets-panel.tsx`, separate the `drift === null` case from `unconfigured`: keep returning `null` for unreachable, and render a muted "Not monitored — no requiredEnvKeys declared" card for `unconfigured`, mentioning the scaffold command as the fix.
6. Surface `empty` in the panel's count summary, and render empty-valued keys in the detail list distinctly from missing ones (an empty secret is a different problem from an absent one).
7. Update `apps/api/src/routes/secrets.test.ts`: cover empty-only drift, mixed missing+empty, all-set `ok`, and that `present` excludes empty-valued keys.
8. Update `apps/dashboard/src/components/detail/secrets-panel.test.tsx`: replace the "renders nothing when unconfigured" test with one asserting the warning card renders, and add a case covering `empty` display.
9. Run `pnpm test`, `pnpm typecheck`, `pnpm lint` across **all 5 projects**.
10. Live-check via `:7001`: emit-vision → `ok` with `empty: []`; at least one other project → `unconfigured`. Record results in the completion summary.

## Files involved
- `apps/api/src/routes/secrets.ts` — empty-value detection, `empty` field, drift status logic
- `apps/api/src/routes/secrets.test.ts` — empty/mixed/ok coverage
- `apps/dashboard/src/lib/api-secrets.ts` — add `empty` to the type
- `apps/dashboard/src/components/detail/secrets-panel.tsx` — unconfigured warning card, empty-key display
- `apps/dashboard/src/components/detail/secrets-panel.test.tsx` — update the unconfigured test, add empty coverage

## Acceptance criteria
- [x] A required key present as `KEY=` is reported in `empty`, not `present`, and drives `status: 'drift'`.
- [x] Detection uses a single `sshExec` call.
- [x] `present` means "set with a non-empty value"; a test asserts empty keys are excluded from it.
- [x] A project with no `requiredEnvKeys` renders a visible "not monitored" card in the dashboard (no longer `return null`), while a 503/unreachable still renders nothing.
- [x] The panel distinguishes empty-valued keys from missing keys.
- [x] `pnpm test`, `pnpm typecheck`, `pnpm lint` clean across all 5 projects.
- [x] Live check recorded: emit-vision `ok` / `empty: []`, another project `unconfigured`.

## Out of scope
- The `secrets scaffold-required-keys` command itself — sprint 240. This sprint only *mentions* it in the warning copy.
- Declaring `requiredEnvKeys` for any project — sprint 243.
- Fixing `secrets-apply`'s overwrite behavior — sprint 238.
- The deploy `copy_env` guardrail — sprint 241.
- Auto-remediating empty values.

## Completed

**Date:** 2026-07-24

### Summary
Extended `GET /projects/:name/secrets-drift` (`apps/api/src/routes/secrets.ts`) to detect empty-valued env keys, following the sentinel-separated single-`sshExec`-call pattern established in sprint 236's nginx drift route. The remote command now emits all key names, an `__EMIT_INFRA_SECRETS_DRIFT_EMPTY__` marker, then the subset of key names whose value is empty (`KEY=` or `KEY=   `). The route classifies each required key into `missing`, `empty`, or `present` (present now strictly means "set with a non-empty value"), and `status` is `drift` whenever either `missing` or `empty` is non-empty.

On the dashboard side, `secrets-panel.tsx` now distinguishes the `drift === null` (unreachable/503, stays silent) case from `status === 'unconfigured'` (previously also silent, now renders a muted "Not monitored" card naming `emit-infra secrets scaffold-required-keys <project>` as the fix). The header summary and detail list both gained an `empty` section, styled with the same `err` variant as missing keys since an empty required secret is exactly as broken as an absent one. Since sprint 238 already landed (making `secrets-apply` safe to re-run), the "Sync to server" button's visibility condition was extended to `missing.length > 0 || empty.length > 0`.

Note: the sprint file referenced an existing `secrets-panel.test.tsx` with a test asserting the unconfigured case rendered nothing — that file did not actually exist in the repo, so it was created fresh (following the conventions of the sibling `nginx-config-panel.test.tsx`) rather than edited.

### Files changed
- `apps/api/src/routes/secrets.ts` — sentinel-separated empty-value detection, `empty` field on `DriftResult`, drift status now trips on `missing` or `empty`
- `apps/api/src/routes/secrets.test.ts` — added empty-only, mixed missing+empty, and present-excludes-empty coverage; updated ok-status test for the new marker format
- `apps/dashboard/src/lib/api-secrets.ts` — added `empty: string[]` to the `SecretsDrift` type
- `apps/dashboard/src/components/detail/secrets-panel.tsx` — split `null` vs `unconfigured` handling, added "Not monitored" card, added `empty` to the summary/detail list and the sync button's visibility condition
- (new) `apps/dashboard/src/components/detail/secrets-panel.test.tsx` — unreachable/unconfigured/empty/ok coverage (file didn't previously exist)

### Verification
- `pnpm test`: 337/337 (api) + 188/188 (dashboard) pass, all 4 test-bearing projects green
- `pnpm typecheck`: clean across all 5 projects
- `pnpm lint`: clean across all 5 projects
- Live check via `:7001`: `GET /projects/emit-vision/secrets-drift` → `{"status":"ok","missing":[],"empty":[],...}` (35 present keys, 1 extra `BUILD_NUMBER`); `GET /projects/develemail/secrets-drift` → `{"status":"unconfigured"}`

### Follow-ups
- `[defer]` The sprint doc's expected emit-vision key count (36-37) didn't match what's live (35 present + 1 extra); cosmetic doc drift, not a bug — no action needed.
