# Document the .env.prod vs ci.envFile split and detect divergence between them
**Difficulty:** 3

## Goal
Make it impossible to add a secret to the wrong file without noticing. Document prominently that `secrets sync` and `deploy` read **different files by default**, and warn when the two sources disagree on a key or when one contains keys the other lacks.

## Reason
This is the **root cause** of emit-vision's silent email outage, not a documentation nicety. Two files do two different jobs and nothing says so:

| File | Read by | Destination |
|---|---|---|
| `.env.prod` (default) | `emit-infra secrets sync` | GitHub repo secrets |
| `ci.envFile` → e.g. `infra/secrets.prod.env` | `emit-infra deploy` (`copy_env`) | server `/opt/<name>/.env` |

So adding a secret to the "obvious" file gets it into GitHub Actions but **never onto the server**. The residue proves this fired: emit-vision's `.env.prod` has **9 keys total, 4 of which are exactly** `DEVELEMAIL_BASE_URL`, `DEVELEMAIL_API_KEY`, `DEVELEMAIL_PROJECT_ID`, `EMAIL_FROM_ADDRESS` — consistent with someone adding the email vars to the file `secrets sync` uses, while `deploy` read `infra/secrets.prod.env`, which lacked them. Transactional email was dead in production for a long, unknown period while the resend endpoint kept returning `200 {"message":"verification_sent_if_found"}`. Both files now carry all four keys, so the incident is remediated — but the trap is fully intact for the next person.

Current documentation is a single tangential line at `docs/DEPLOYMENT-PITFALLS.md:224` ("Always sync from `.env.prod` ... never from `.env`"), which does not mention `ci.envFile` at all. Nothing in `README.md`. Nothing in `emit-infra secrets --help`.

## Context
- **The two resolvers, verified 2026-07-24:**
  - `apps/cli/src/commands/secrets-sync.ts:60` — `resolveEnvFile(cwd)` returns `.env.prod` if it exists, else `.env`. It **never** consults `ci.envFile`.
  - `apps/cli/src/commands/deploy.ts:143` — `[config.ci?.envFile, '.env.prod', '.env']`, first match wins.
  - Note sprint 238 aligns the `secrets-apply` API route to deploy's precedence; if 238 has landed, read its `## Completed` section so the docs describe current reality, and mention that the dashboard's "Sync to server" button follows the deploy source.
- **Fleet reality** (useful for doc examples): emit-vision is the only project with a non-default `ci.envFile` (`infra/secrets.prod.env`, 36 keys, alongside a 9-key `.env.prod`). develemail, tastease, and diner-decider set `ci.envFile: ".env.prod"` — pointing at the same file, so no divergence. emit-social and martialops set no `ci.envFile`. So emit-vision is the one project where the split is live, and the natural test case.
- **Where the divergence warning belongs.** `secrets sync` is the right place: it is the command that writes to the "wrong" destination in the failure story. When the deploy's resolved `env_src` differs from the file `secrets sync` is about to read, compare the two key sets and warn about (a) keys `sync` would push that the deploy's file lacks — these will never reach the server — and (b) keys whose **values differ** between the two files. Keep the comparison pure and unit-testable; the command shell stays thin (house style).
- **Value comparison — be careful not to leak secrets.** Report only key *names* and the fact that values differ. **Never print secret values** to stdout or logs.
- **Do not collapse the split in this sprint.** The emit-vision team asked whether one file should be the source of truth with a declared projection to each destination. That is a real design question with migration implications for five repos — capture it as a documented follow-up, do not implement it here. This sprint makes the current split *legible and monitored*.
- **`--help` text:** the `secrets` group and its `sync` subcommand are defined at `secrets-sync.ts:10-18`. The existing `--env-file` option description ("Path to .env file (default: .env.prod, falls back to .env)") is accurate but silent about the deploy split — extend the command description and/or option help so the distinction is visible where people actually look.
- **⚠️ CLI dist rebuild is mandatory** — this repo executes `apps/cli/dist`. Any change to help text or the warning logic must be rebuilt via `npx nx run cli:build` and verified in the built output.
- **Full typecheck required** — run `pnpm typecheck` across all 5 projects, not just `cli`.

## Tasks
1. Add a clearly-titled section to `README.md` explaining the two env files: which command reads which, where each lands, and the failure mode of putting a secret in only one. Include the table from this sprint's Reason section and a concrete "how to add a new production secret" checklist that names both destinations.
2. Rewrite/extend `docs/DEPLOYMENT-PITFALLS.md:224` into a full numbered pitfall entry in that file's established style (Symptom / Cause / Fix), using the emit-vision email outage as the worked example — it is the canonical case and future readers will search for it.
3. Extend the `secrets` / `secrets sync` command descriptions and option help so `emit-infra secrets --help` states that `deploy` reads a different file (`ci.envFile`) and that syncing does not put a secret on the server.
4. Add an exported pure helper that, given two parsed env files, returns: keys only in the sync source, keys only in the deploy source, and keys whose values differ (names only — never values).
5. Wire that helper into `secrets sync`: resolve the deploy-side `env_src` the same way `deploy.ts:143` does, and when it differs from the file being synced, print a warning summarizing the three categories with actionable guidance. Warn — do not block.
6. Add unit tests for the pure helper (only-in-A, only-in-B, differing values, identical files, and the same-path case producing no warning).
7. Rebuild the CLI (`npx nx run cli:build`) and confirm the new help text appears in `apps/cli/dist`.
8. Run `pnpm test`, `pnpm typecheck`, `pnpm lint` across **all 5 projects**.
9. Verify live (read-only): run `emit-infra secrets sync --dry-run` in `~/projects/emit-vision` and confirm the divergence warning fires and names the right keys (its two files genuinely differ: 9 vs 36 keys). Then run it in a project where `ci.envFile` is `.env.prod` (e.g. `develemail`) and confirm **no** warning. Record both in the completion summary. Do **not** run a real (non-dry-run) sync.
10. Record the "should the split exist at all?" question as a documented follow-up in `backlog.md`, with the migration considerations noted.

## Files involved
- `README.md` — new section on the two env files and how to add a production secret
- `docs/DEPLOYMENT-PITFALLS.md` — promote line 224 into a full pitfall entry with the emit-vision case
- `apps/cli/src/commands/secrets-sync.ts` — help text, divergence detection wiring, pure comparison helper
- `apps/cli/src/commands/secrets-sync.test.ts` — tests for the comparison helper
- `apps/cli/src/commands/deploy.ts` — read-only reference for the `env_src` precedence to mirror
- `backlog.md` — capture the single-source-of-truth design question
- `apps/cli/dist/*` — rebuilt; must contain the new help text

## Acceptance criteria
- [x] `README.md` documents which command reads which file and where each lands, with a checklist for adding a new production secret.
- [x] `docs/DEPLOYMENT-PITFALLS.md` has a full pitfall entry for the split, using the emit-vision email outage as the example.
- [x] `emit-infra secrets --help` states that `deploy` reads a different file than `sync`.
- [x] `secrets sync` warns when the deploy-resolved `env_src` differs from the synced file, listing keys unique to each side and keys whose values differ — **by name only, never values**.
- [x] No warning fires when both resolve to the same path.
- [x] The comparison logic is a pure, unit-tested function.
- [x] `apps/cli/dist` rebuilt and contains the new help text.
- [x] `pnpm test`, `pnpm typecheck`, `pnpm lint` clean across all 5 projects.
- [x] Live dry-run results recorded for emit-vision (warns) and a same-path project (silent).

## Out of scope
- **Unifying the two files into one source of truth** — captured as a backlog follow-up. It touches five repos and needs its own plan.
- Changing which file either command resolves (behavior stays the same; only visibility improves).
- The `secrets-apply` route — sprint 238.
- Deploy removal guardrails — sprint 241.
- Drift detection changes — sprint 239.
- Printing or logging any secret values.

## Completed

**Date:** 2026-07-24

### Summary
Made the `.env.prod` (synced to GitHub secrets) vs `ci.envFile` (copied to the server on deploy) split visible and monitored, without collapsing it. Added a "Production secrets: two files, two destinations" section to `README.md` with the resolver table and a 4-step add-a-secret checklist, and promoted the single tangential line at `docs/DEPLOYMENT-PITFALLS.md:224` into a full numbered entry (#22) that uses the emit-vision transactional-email outage as the worked example, cross-linked from the related-but-distinct entry #11 and added to the debugging checklist.

On the CLI side, `secrets --help` and `secrets sync --help` now state outright that `deploy` reads a different file and that syncing doesn't put anything on the server. `secrets-sync.ts` gained an exported pure helper, `diffEnvSources`, that takes two parsed env-entry arrays and returns `onlyInSync` / `onlyInDeploy` / `differing` key-name arrays — never values. It's wired into the `sync` action via `warnIfDeploySourceDiverges`, which resolves the deploy-side file with the exact same precedence deploy.ts uses (`config.ci?.envFile` → `.env.prod` → `.env`, first existing wins), and — only when that resolved path differs from the file being synced — parses it and prints a non-blocking `chalk.yellow` warning naming the divergent keys. When the two paths are identical (the common case, no `ci.envFile` override), the check exits before ever reading or diffing a second file, so there's no warning and no extra I/O.

Live verification against the two real fleet cases the sprint asked for: emit-vision (`ci.envFile: infra/secrets.prod.env`, genuinely different from `.env.prod`) fires the warning and correctly lists the 26 keys only present in the deploy file — with no `onlyInSync` or `differing` entries, confirming the four `DEVELEMAIL_*`/`EMAIL_FROM_ADDRESS` keys from the original incident are now present and matching in both files. develemail (`ci.envFile: .env.prod`, same file both ways) produces no warning at all, exercising the same-path short-circuit for real.

### Files changed
- `README.md` — new "Production secrets: two files, two destinations" section; `secrets sync` row in the commands table now flags the split
- `docs/DEPLOYMENT-PITFALLS.md` — new pitfall entry #22 (Symptom/Cause/Fix) using the emit-vision outage; cross-reference added to entry #11; new line 17 in the debugging checklist
- `apps/cli/src/commands/secrets-sync.ts` — extended `secrets`/`sync` command and option descriptions; added `resolveDeployEnvSource`, exported `diffEnvSources` (+ `EnvSourceDiff` type), and `warnIfDeploySourceDiverges`, wired into the `sync` action before the dry-run/confirm branches
- `apps/cli/src/commands/secrets-sync.test.ts` — 5 new `diffEnvSources` unit tests (only-in-sync, only-in-deploy, differing values, identical files, both-empty) plus 2 command-level tests (divergence warning fires with the right keys and no leaked values; no warning when paths resolve identically)
- `backlog.md` — captured the "collapse to one source of truth" design question as a `[design]` follow-up with the five-repo migration caveat
- `apps/cli/dist/*` — rebuilt via `npx nx run cli:build`; verified new help text and warning logic present in the built output

### Verification
- `pnpm test`: 111/111 pass in `cli` (15 in `secrets-sync.test.ts`), all 5 projects clean overall
- `pnpm typecheck`: clean across all 5 projects
- `pnpm lint`: clean across all 5 projects
- `emit-infra secrets --help` / `secrets sync --help` (run against rebuilt `dist`): both show the new split-awareness text
- Live dry-run, emit-vision (`~/projects/emit-vision`): `emit-infra secrets sync --dry-run` printed the divergence warning, listing 26 keys present only in `infra/secrets.prod.env` (the deploy source) — no `onlyInSync` or `differing` keys, i.e. the 9 keys in `.env.prod` are a matching subset
- Live dry-run, develemail (`~/projects/develemail`): `emit-infra secrets sync --dry-run` printed no warning (`ci.envFile` is `.env.prod`, same path both ways)
- No real (non-dry-run) sync was run against any project

### Follow-ups
- `[defer]` The single-source-of-truth design question (collapsing `.env.prod` and `ci.envFile` into one file with a declared projection) is captured in `backlog.md` as a `[design]` item — real migration work across five repos, not attempted here.
- `[defer]` `docs/DEPLOYMENT-PITFALLS.md` has a pre-existing numbering artifact (two entries both titled "20", at lines ~462 and ~525) predating this sprint — left alone since renumbering wasn't in scope, but worth a cleanup pass if the file's numbering is ever audited.
- `[defer]` `warnIfDeploySourceDiverges` re-reads and re-parses the deploy-side file on every `sync` invocation; fine at current fleet scale (single-digit KB files), but if env files grow large this could be revisited.
