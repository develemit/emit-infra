# Fix the nginx drift route to compare against the config nginx actually serves
**Difficulty:** 3

## Goal
`GET /projects/:name/nginx-drift` should compare the repo vhost against the file nginx **actually loads** (`/etc/nginx/sites-enabled/<name>`), not the conventional-but-sometimes-orphaned `/etc/nginx/sites-available/<name>`. After this change, tastease reports `ok` instead of 201 lines of phantom drift, with no server-side change.

## Reason
The drift route hardcodes `serverPath = /etc/nginx/sites-available/<name>` and assumes `sites-enabled/<name>` is always a symlink into `sites-available/`. That holds for most of the fleet, but not tastease: its `sites-enabled/tastease` is a **standalone regular file** (the config nginx truly serves, byte-identical to the repo), while `sites-available/tastease` is a **stale orphaned copy** with old upstream names that nginx never loads. The route reads the orphan and reports 201 lines of drift that don't reflect production reality — verified live on 2026-07-24 (`nginx -t` passes, served file == repo). A drift tool that watches a file nginx doesn't load is worse than no tool: it cries wolf and trains people to ignore it. This fixes the detector to read ground truth. Logged in `backlog.md` (2026-07-24, tagged `[address]`).

## Context
- **Route:** `apps/api/src/routes/nginx-config.ts`. The relevant lines today:
  - line 40: `const serverPath = \`/etc/nginx/sites-available/${name}\``
  - line 58: `sshExec(host, \`cat ${serverPath} 2>/dev/null || true\`, key)`
  - line 61: empty server output → `status: 'missing-server'`
  - The response includes `serverPath` in the `missing-server`, `ok`, and `drift` shapes (see the `NginxDriftResult` union at lines ~13-17).
- **Pure helpers** (do not need changes): `apps/api/src/lib/nginx-diff.ts` — `normalizeConfig(raw)` and `diffConfigLines(local, server, maxLines=200)`.
- **Tests:** `apps/api/src/routes/nginx-config.test.ts` mocks `@emit-infra/core`'s `sshExec` and asserts on the returned JSON. It's the model to follow — study how it stubs `sshExec` per-status (`ok`, `drift`, `missing-server`, `503`). The shared fixture `mockProject` sets `nginx: { wildcardCert, syncOnDeploy, customConfigSrc }` — keep that shape.
- **`cat` follows symlinks transparently.** `cat /etc/nginx/sites-enabled/<name>` returns the served content whether that path is a symlink (normal case) or a standalone regular file (tastease). So switching the read target to `sites-enabled` is the core fix and covers both layouts in one command.
- **Real edge case to handle — "configured but not enabled":** a project can have `sites-available/<name>` present but no `sites-enabled/<name>` (vhost staged but disabled). Reading only `sites-enabled` would report `missing-server` even though a file is deployed. Distinguish these: if `sites-enabled/<name>` is absent but `sites-available/<name>` exists, report a distinct status (`disabled`) rather than `missing-server`. If neither exists, `missing-server` as today.
- **Naming safety:** `name` matches `SAFE_NAME_RE` via the zod param schema before interpolation — no shell-injection concern, same as today.
- **Verification uses the live fleet.** The API runs locally on `:7001`. After the change, hit the route for all five projects (`emit-vision`, `develemail`, `emit-social`, `diner-decider`, `tastease`) and confirm each reports sensibly. tastease is the key one — it must flip to `ok`. SSH keys are per-project (`project.config.sshKeyName`); the helper `sshKeyPath` already resolves them.

## Tasks
1. In `nginx-config.ts`, read from `/etc/nginx/sites-enabled/${name}` as the primary served path. Fetch it with the existing `cat ... 2>/dev/null || true` pattern over `sshExec`.
2. Handle the enabled-vs-available distinction in a **single remote command** to avoid a second round-trip. Suggested shell: read the enabled file; if empty, probe whether `sites-available/<name>` exists, and emit a sentinel the route can parse. For example: `cat /etc/nginx/sites-enabled/${name} 2>/dev/null || true` and, when that is empty, a follow-up `test -f /etc/nginx/sites-available/${name} && echo __AVAILABLE_NOT_ENABLED__ || true` — or combine both into one `sshExec` call with a `;`-joined script and parse the result. Keep it to one `sshExec` invocation.
3. Add a `disabled` variant to the `NginxDriftResult` union: `{ status: 'disabled'; localPath: string; serverPath: string }` where `serverPath` names the `sites-available` file that exists but isn't enabled. Keep `missing-server` for the truly-absent case (neither enabled nor available).
4. Set the reported `serverPath` to the path actually read (`/etc/nginx/sites-enabled/<name>`) for the `ok`/`drift`/`missing-server` shapes, so the response reflects ground truth.
5. Update `apps/api/src/routes/nginx-config.test.ts`: adjust existing `ok`/`drift`/`missing-server` tests to the new served path, and add coverage for the new `disabled` status (sites-available present, sites-enabled absent). Follow the existing `sshExec` mocking style; if you combined commands into one script, mock its combined output.
6. Run `npx nx run api:test`, `npx nx run api:typecheck`, and `npx nx run api:lint`. All must pass.
7. With the local API running on `:7001`, curl `/projects/<name>/nginx-drift` for all five fleet projects. Confirm: tastease → `ok`; emit-vision/develemail/emit-social → `ok`; diner-decider → `ok`; none report the old phantom `drift`. Capture the results in the completion summary.

## Files involved
- `apps/api/src/routes/nginx-config.ts` — switch the read target to `sites-enabled`, add the `disabled` status, report the true path
- `apps/api/src/routes/nginx-config.test.ts` — update paths, add `disabled` coverage
- `apps/api/src/lib/nginx-diff.ts` — read-only reference; the diff/normalize logic does not change

## Acceptance criteria
- [x] The route reads `/etc/nginx/sites-enabled/<name>` (the served config), following symlinks and reading standalone regular files alike, in a single `sshExec` call.
- [x] A project with `sites-available/<name>` present but not enabled returns a distinct `disabled` status, not `missing-server`.
- [x] The reported `serverPath` reflects the file actually compared.
- [x] `npx nx run api:test`, `api:typecheck`, and `api:lint` all pass.
- [x] Live check: tastease returns `ok` (was 201-line `drift`); the other four projects still report correctly. Results recorded in the completion summary.

## Completed

**Date:** 2026-07-24

### Summary
Switched the drift route's read target from `/etc/nginx/sites-available/<name>` to `/etc/nginx/sites-enabled/<name>` — `cat` follows symlinks transparently, so this covers both the normal (`sites-enabled` → symlink → `sites-available`) layout and tastease's standalone-regular-file layout in one code path. To keep the enabled-vs-available distinction to a single `sshExec` round-trip, the route now sends a combined shell script (`cat sites-enabled; echo <split-marker>; test -f sites-available && echo <available-marker>`) and parses the response by locating the split marker. When the enabled path is empty and the available path exists, the route now returns a new `disabled` status (`{ status: 'disabled', localPath, serverPath: <sites-available path> }`) instead of the old `missing-server`. True absence of both files still reports `missing-server`, now with `serverPath` pointed at `sites-enabled` (the path actually probed) rather than `sites-available`.

### Files changed
- `apps/api/src/routes/nginx-config.ts` — read `sites-enabled` via combined single-sshExec script with split/available sentinels, added `disabled` status to the `NginxDriftResult` union, `serverPath` now reflects the path actually compared
- `apps/api/src/routes/nginx-config.test.ts` — updated `ok`/`drift`/`missing-server` tests for the new combined-script mock shape and `sites-enabled` serverPath, added a `disabled` status test

### Verification
- `npx nx run api:test`: 330/330 pass (8 in `nginx-config.test.ts`, including the new `disabled` case)
- `npx nx run api:typecheck`: clean
- `npx nx run api:lint`: clean
- Live check against the running local API (`tsx --watch`, already picked up the change) for all five fleet projects:
  - `emit-vision` → `ok` (125/125 lines)
  - `develemail` → `ok` (71/71 lines)
  - `emit-social` → `ok` (52/52 lines)
  - `diner-decider` → `ok` (114/114 lines)
  - `tastease` → `ok` (179/179 lines) — previously reported 201-line `drift` against the orphaned `sites-available` copy; now correctly compares against the served `sites-enabled` file and matches the repo.

### Follow-ups
- `[defer]` Sprint 237 (reconciling `sites-available/tastease` so it's not an orphaned stale file) is unaffected by this sprint and remains queued separately.
- `none` otherwise — no new issues surfaced.

## Out of scope
- Any change to the tastease **server** — that's sprint 237. This sprint only fixes the detector; tastease reporting `ok` afterward is because its served config already matches the repo.
- Touching `nginx-diff.ts` normalize/diff logic.
- The dashboard drift panel UI (sprint 231) — it consumes this route's JSON unchanged; the new `disabled` status can surface later if desired but needs no UI work here.
- Reconciling the orphaned `sites-available/tastease` file (sprint 237).
