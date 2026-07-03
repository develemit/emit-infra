# DX housekeeping: standalone output, gitignore artifact, unify vitest, align docs
**Difficulty:** 2

## Goal
Four small repo-health items are closed: Next.js builds standalone output, the stray `typecheck-output.txt` is gone and ignored, all packages share one vitest major version, and SETUP.md's Node requirement matches reality.

## Reason
Pure friction removal, flagged by the 2026-07-02 scan. The standalone-output item has a real payoff (README documents a ~2GB→300MB production image reduction that was never actually configured); the rest is drift that confuses future sessions.

## Context
- `apps/dashboard/next.config.ts` — add `output: 'standalone'`. README.md (~lines 106-108) already documents this intent. **Gotcha from project memory:** the standalone `server.js` defaults to PORT 3000 — deployment maps ports via the PORT env var (see ansible `app-deploy` role / blue-green-deploy.sh). Verify the deploy scripts under `ansible/roles/app-deploy/files/` already set PORT before assuming this is safe; if they do, just add the config. Confirm `npx nx run dashboard:build` still succeeds and produces `.next/standalone/`.
- `typecheck-output.txt` at repo root — a stray debug artifact. Delete it and add it to `.gitignore` (check whether it's tracked: `git ls-files typecheck-output.txt`; if tracked, `git rm --cached`).
- vitest versions: root `package.json` has `^3.0.0`, `apps/api` `^3.2.6`, `apps/dashboard` `^4.1.8`. Unify on ONE version. Check what dashboard tests actually rely on from v4 before deciding direction; if nothing v4-specific, pin all to the same latest 3.x; otherwise move all to the same 4.x. After changing, run `pnpm install` and the full test suite for both apps — this is the risky step, so verify thoroughly.
- `SETUP.md` line ~5 says Node "v20.x or later"; README says v24+. Align SETUP.md to whatever the repo actually requires (check `engines` fields and `@types/node` major).

## Tasks
1. Verify PORT handling in the deploy scripts, then add `output: 'standalone'` to `next.config.ts`; run a dashboard build to confirm.
2. Remove `typecheck-output.txt` (untrack if tracked) and gitignore it.
3. Unify vitest versions across root/api/dashboard; `pnpm install`; run both test suites.
4. Fix the Node version line in SETUP.md.
5. Full verification: `pnpm typecheck`, `pnpm test`, dashboard build.

## Files involved
- `apps/dashboard/next.config.ts` — standalone output
- `.gitignore` — add typecheck-output.txt
- `package.json`, `apps/api/package.json`, `apps/dashboard/package.json`, `pnpm-lock.yaml` — vitest unification
- `SETUP.md` — Node version
- (verify only) `ansible/roles/app-deploy/files/blue-green-deploy.sh` — PORT env handling

## Acceptance criteria
- [ ] `nx run dashboard:build` produces standalone output and deploy PORT handling is confirmed compatible
- [ ] `typecheck-output.txt` deleted and ignored
- [ ] One vitest version across the monorepo; both test suites pass
- [ ] SETUP.md and README agree on Node version
- [ ] Typecheck clean

## Out of scope
- Splitting >300-line CLI files (`audit.ts`) — backlog
- Any CI workflow changes

## In Progress

**Started:** 2026-07-03T03:00:00Z
