# Pass `blue_green` through the provisioning path so the nginx role's slot tasks can run
**Difficulty:** 3

## Goal
`emit-infra configure` and `emit-infra setup` pass `blue_green` (and the slot
ports) to the provisioning playbook, so the nginx role actually creates
`/etc/nginx/blue-green/<project>.conf` before the first deploy — and
DEPLOYMENT-PITFALLS #17 becomes true.

## Reason
A first blue-green deploy to a freshly provisioned server fails at nginx reload
with:
```
[emerg] open() "/etc/nginx/blue-green/<project>.conf" failed (2: No such file
or directory) in /etc/nginx/sites-enabled/<project>:20
```
This bit the martialops rebuild on 2026-08-26.

DEPLOYMENT-PITFALLS #17 tells you the Ansible nginx role already handles it —
"run the playbook before the first deploy." **That is not true via any CLI
path**, and the pitfall entry has been quietly misleading since it was written.

The reason is narrower than "configure forgot a variable". Verified
2026-08-26:
- `configure.ts` contains **0** references to `blue_green`.
- `setup.ts` contains **0** references to `blue_green`.
- The nginx role runs **only** in `provision.yml`.
- `provision.yml` is invoked **only** by `configure.ts:44` and `setup.ts:262`.
- `deploy.yml` contains the `app-deploy` role and **no nginx tasks** — so the
  4 `blue_green` references in `deploy.ts` never reach the nginx role.

So no CLI code path can set `blue_green=true` while the nginx role runs, which
makes three gated behaviours unreachable dead code:
- `nginx/tasks/main.yml:122` — picks `upstream-site.conf.j2` vs `site.conf.j2`
- `nginx/tasks/main.yml:137` — creates `/etc/nginx/blue-green/`
- `nginx/tasks/main.yml:152` — writes the initial blue-slot config

On established servers the slot file exists only because
`blue-green-deploy.sh` wrote it during some earlier successful deploy. Fresh
servers have the chicken-and-egg, which is why only a true rebuild surfaced it.

## Context

### The live-config risk was audited and is nil
Enabling `blue_green` changes which template `main.yml:122` renders. That would
matter for a blue-green project **without** `nginx.customConfigSrc`, because
the role would start rendering `upstream-site.conf.j2` where it previously
rendered `site.conf.j2`.

Audited across the fleet on 2026-08-26 — every blue-green project
(`develemail`, `diner-decider`, `emit-billing`, `emit-social`, `emit-vision`,
`martialops`, `tastease`) also sets `customConfigSrc`. The role's own template
task is gated `when: nginx_custom_config_src is not defined`
(`main.yml:127`), so it is skipped for all of them and **no existing project's
vhost changes**.

Re-run that audit as task 1 rather than trusting this paragraph — if a project
has been added since, it is exactly the one that would break.

### Where the variables come from
`deploy.ts` already builds these correctly — read `buildDeployExtraVars` and
mirror its naming rather than inventing new variable names. The slot ports the
nginx template expects are `blue_web_port` / `blue_api_port` /
`blue_worker_port` / `blue_marketing_port`, defaulting to 4300-4303
(`main.yml:143-150`). `ansible/README.md:76-78` documents `blue_green` and its
companions.

Config side: projects declare blue-green under `deploy.blueGreen` (see any
fleet `.emit-infra.json`, and `ProjectConfigSchema` in `packages/types`).

### Two entry points, one behaviour
`configure` and `setup` must agree. `setup` runs provisioning as part of a
larger flow (`setup.ts:262`); `configure` is the standalone re-run
(`configure.ts:44`). Extract the extra-vars construction if that keeps them in
sync — duplicating the logic twice is how they drifted apart from `deploy` in
the first place.

### The doc correction is part of the sprint
`docs/DEPLOYMENT-PITFALLS.md` #17 (line ~346) currently documents behaviour
that does not happen. Correcting it is a required task, not a nicety —
leaving it would mean the fix lands while the docs still describe the old
broken assumption as the workaround.

## Tasks
1. Re-run the fleet audit: list every project with `blueGreen` set and whether
   it also sets `nginx.customConfigSrc`. Record the table in the Completed
   section. If any project has blue-green **without** customConfigSrc, stop and
   flag it before proceeding — that project's vhost would change.
2. Pass `blue_green` and the blue-slot ports from config in `configure.ts`,
   mirroring `deploy.ts`'s naming.
3. Do the same in `setup.ts`.
4. Factor the shared construction so the two cannot drift.
5. Verify the nginx role now creates the directory and slot file on a
   blue-green project — use `--check`/dry-run or a scratch target rather than
   re-provisioning a live server.
6. Confirm a non-blue-green project is unaffected (no directory, no slot file,
   same template as before).
7. Correct DEPLOYMENT-PITFALLS #17 to describe what actually happens now.
8. Add tests asserting the extra-vars construction for both commands.

## Files involved
- `apps/cli/src/commands/configure.ts` — pass `blue_green` + slot ports
- `apps/cli/src/commands/setup.ts` — same
- new file (likely): a shared extra-vars helper + its test
- `apps/cli/src/commands/configure.test.ts` — created by sprint 315; extend it
- `docs/DEPLOYMENT-PITFALLS.md` — correct #17
- `ansible/roles/nginx/tasks/main.yml` — read-only; no change expected

## Acceptance criteria
- [ ] The fleet audit table is recorded, and every blue-green project is
      confirmed to also use `customConfigSrc` (or the exception is flagged).
- [ ] `configure` and `setup` both pass `blue_green` and the blue-slot ports
      for a blue-green project, and neither passes them for a non-blue-green
      one.
- [ ] Tests assert the extra-vars for both commands, both cases — name the
      test file.
- [ ] A dry-run/check against a blue-green project shows the nginx role would
      create `/etc/nginx/blue-green/` and the slot config; a non-blue-green
      project shows neither.
- [ ] No existing project's rendered vhost template changes — demonstrate,
      don't assert.
- [ ] DEPLOYMENT-PITFALLS #17 describes actual behaviour.
- [ ] `pnpm test` and `pnpm typecheck` clean.

## Out of scope
- Changing the nginx role's tasks or templates — they are correct; nothing was
  passing them the gating variable.
- The GHCR login gap in blue-green deploys — sprint 317.
- Re-provisioning any live server. Verification is dry-run or scratch only.
