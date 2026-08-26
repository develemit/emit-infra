# Refuse to run Ansible against an inventory that disagrees with the project config
**Difficulty:** 3

## Goal
`resolveInventoryPath` validates an existing `ansible-inventory.ini` against the
project's known server address and refuses on mismatch, so neither `configure`
nor `deploy` can ever target a different product's server.

## Reason
This is the only gap in `docs/ops/emit-infra-upstream-findings.md` that **fails
silently against the wrong machine**. Every other item fails loudly and
locally.

During the martialops rebuild (2026-08-26), its `ansible-inventory.ini` still
held `178.104.195.59` from the VPS destroyed on 2026-07-24. Hetzner had since
reassigned that address to **tastease**, which is live. Running
`emit-infra configure` would have executed the full provisioning playbook — SSH
hardening, UFW rules, Docker install, nginx config — against tastease's
production server, and reported success. It was caught only by hand-diffing the
inventory against Terraform output.

It is also a **recurrence**. On 2026-07-24 this exact hazard was found and
closed by removing `serverIp` from martialops' `.emit-infra.json`, because that
field pointed at tastease. The inventory file is a second, independent door to
the same hazard that the earlier fix never covered. Verified still true today:
tastease's `serverIp` is `178.104.195.59`.

## Context

### The current code
`apps/cli/src/commands/configure.ts:50`:
```ts
export async function resolveInventoryPath(projectName: string, config?: ProjectConfig): Promise<string> {
  const inventoryPath = join(process.cwd(), 'ansible-inventory.ini')

  if (existsSync(inventoryPath)) return inventoryPath   // ← unconditional

  if (config?.serverIp) { /* writes a fresh inventory */ }

  const tfDir = join(process.cwd(), 'terraform')
  const ip = await getTerraformOutput('server_ip', tfDir)
  ...
}
```
The early return is the bug: contents are never checked against anything.

### Blast radius is both commands
This function is exported from `configure.ts` and imported by
`deploy.ts:7`, used at `deploy.ts:298`. So a stale inventory misroutes
**deploys** as well as provisioning. Fixing the shared resolver fixes both —
do not fix it at one call site.

### Cases the check must handle
- **`config.serverIp` present** (the common case — 6 of 7 blue-green projects
  have one): parse the host from the inventory and compare.
- **`config.serverIp` absent**: `emit-social` has no `serverIp`. Fall back to
  `getTerraformOutput('server_ip', tfDir)` for the comparison. If neither
  source is available, there is nothing to compare against — allow, but say so.
- **`--inventory <path>`**: already exists as a flag on both commands and is
  the deliberate-override escape hatch. It bypasses this function entirely
  today (`opts.inventory ?? await resolveInventoryPath(...)`), so overriding
  already works — confirm that stays true and document it in the error message.
- **Inventory shape**: files in this fleet look like
  `[martialops]\n178.105.239.144 ansible_user=root ansible_ssh_private_key_file=~/.ssh/emit-deploy ansible_ssh_common_args='...'`.
  Parse the host token, not the whole line. Tolerate comments, blank lines,
  and multiple groups. If the file contains **more than one distinct host**,
  that is itself worth refusing on rather than guessing which one counts.

### Error quality matters here
The whole point is that a human notices. The message must name **both**
addresses, the file path, and the `--inventory` override. A generic
"inventory mismatch" would have been almost as easy to skip past as the
silence it replaces.

### Testing
There is **no `configure.test.ts`** today — create one.
`apps/cli/src/commands/deploy.test.ts` is the closest model for how command
modules are tested here. `resolveInventoryPath` is already exported, so it can
be tested directly with a temp cwd.

## Tasks
1. Add validation to `resolveInventoryPath`: when an inventory file exists,
   determine the expected host (`config.serverIp`, else Terraform output) and
   compare against the host parsed from the file.
2. On mismatch, throw with a message naming the file path, the address found,
   the address expected, where the expectation came from, and the
   `--inventory` override.
3. On a multi-host inventory, refuse rather than guess.
4. When no expected address can be determined, proceed but print a visible
   note that no validation was possible.
5. Write an inventory-parsing helper (host extraction) as a pure exported
   function so it can be unit tested without filesystem setup.
6. Confirm `--inventory` still bypasses cleanly on both `configure` and
   `deploy`.
7. Create `apps/cli/src/commands/configure.test.ts` covering every case below.
8. Verify against the real fleet read-only: for each project with both a
   config `serverIp` and an inventory file, confirm the new check passes and
   flags nothing. A false positive here blocks real deploys, so prove it.

## Files involved
- `apps/cli/src/commands/configure.ts` — `resolveInventoryPath` validation +
  new parsing helper
- new file: `apps/cli/src/commands/configure.test.ts` — tests
- `apps/cli/src/commands/deploy.ts` — no change expected; confirm it inherits
  the fix through the shared import

## Acceptance criteria
- [x] A matching inventory is accepted unchanged.
- [x] A mismatched inventory throws, and the error names both addresses, the
      file path, and the `--inventory` override.
- [x] The martialops scenario is covered explicitly as a test case: config
      says one IP, inventory holds another live project's IP → refused.
- [x] A multi-host inventory is refused, not guessed.
- [x] With no `serverIp` and no Terraform output, the run proceeds with a
      visible note.
- [x] `--inventory` bypasses validation on both commands.
- [x] `deploy` inherits the check — prove it with a test or a documented trace
      through the shared import, not an assertion.
- [x] `configure.test.ts` covers all of the above, including the host-parsing
      helper against commented, blank-line, and multi-group files.
- [x] Every current fleet project with an inventory passes the new check (no
      false positives) — paste the results.
- [x] `pnpm test` and `pnpm typecheck` clean.

## Out of scope
- Making `ansible-inventory.ini` fully generated-and-owned (regenerated from
  Terraform on every run). The findings doc raises it as an option; it would
  change behaviour for anyone hand-editing the file, so it needs its own
  decision. File it as a follow-up rather than doing it here.
- The other findings-doc gaps — sprints 316-320.
- Any change to what the provisioning playbook actually does.

## Completed

**Date:** 2026-08-26

### Summary
`resolveInventoryPath` (`apps/cli/src/commands/configure.ts`) now validates an
existing `ansible-inventory.ini` against the project's known server address
before returning it, closing the silent-wrong-target gap described in the
sprint. A new pure helper, `parseInventoryHosts`, extracts distinct host
tokens from inventory content — tolerating comments, blank lines, `[group]`
headers, trailing `ansible_*=` args (including quoted values), and multiple
groups pointing at the same host (which collapse to one entry rather than
tripping the multi-host refusal).

`validateInventory` compares the parsed host against `config.serverIp`, or
falls back to `getTerraformOutput('server_ip', ...)` when `serverIp` is
absent (the `emit-social` case). If neither source resolves, it prints a
visible note and proceeds rather than blocking — there's nothing to compare
against. On a mismatch it throws, naming the inventory path, both addresses,
where the expectation came from, and the `--inventory` override. A
multi-host file is refused outright rather than guessed at. `--inventory`
continues to bypass `resolveInventoryPath` entirely at both call sites
(`configure.ts:18`, `deploy.ts:298`) — unchanged, confirmed with tests.

**Live finding during fleet verification (task 8):** running the new check
read-only against every current fleet project surfaced a real, pre-existing
mismatch on **emit-vision** — its `ansible-inventory.ini` still holds
`178.105.227.175` (the Hetzner server's raw primary IPv4), while
`.emit-infra.json`'s `serverIp` has pointed at the Terraform-managed floating
IP `46.225.249.8` since sprint 446 (2026-08-02). DNS confirms `46.225.249.8`
is the live production address (`api.emitvision.com` resolves there); no
other fleet project claims `178.105.227.175`, so this isn't the
different-live-project hazard martialops hit, but it is a second real
instance of exactly the class of drift this sprint exists to catch — and
`emit-infra configure`/`deploy` will now correctly refuse to run against
emit-vision until its inventory file is regenerated or fixed. That fix is
out of scope here (different repo, not part of this sprint's file list) and
is called out below rather than applied silently.

### Files changed
- `apps/cli/src/commands/configure.ts` — added `parseInventoryHosts` (pure,
  exported) and `validateInventory`; `resolveInventoryPath` now validates
  an existing inventory instead of returning it unconditionally.
- (new) `apps/cli/src/commands/configure.test.ts` — 15 tests covering
  `parseInventoryHosts`, `resolveInventoryPath`'s validation branches
  (match, mismatch, martialops-scenario regression, multi-host refusal,
  terraform fallback, terraform-mismatch, no-source-available note),
  the `configure` command's `--inventory` bypass, and a source-text trace
  proving `deploy.ts` imports `resolveInventoryPath` from `configure.ts`
  rather than a local copy.

### Verification
- `pnpm test`: 217/217 pass (20 test files).
- `pnpm typecheck`: clean (5 projects).
- `pnpm lint`: clean (5 projects).
- Fleet read-only check (via `resolveInventoryPath`, no ansible invoked,
  no files written since all 7 already had inventories):
  ```
  develemail:     OK
  diner-decider:  OK
  emit-billing:   OK
  emit-social:    OK   (validated via terraform fallback — serverIp is unset,
                        terraform output 167.233.169.206 matches inventory)
  emit-vision:    FLAGGED — genuine pre-existing drift, see Summary above
  martialops:     OK
  tastease:       OK
  ```
  6/7 pass with zero false positives; the one flag is a true positive.

### Follow-ups
- `[blocker]` emit-vision's `ansible-inventory.ini` (178.105.227.175) is
  stale against its own `config.serverIp`/DNS-live address (46.225.249.8,
  set in sprint 446). `emit-infra configure`/`deploy` for emit-vision will
  now refuse until someone regenerates or hand-fixes that file (delete it
  and let `resolveInventoryPath` rewrite it from `config.serverIp`, or edit
  it in place) — needs doing before the next emit-vision provision/deploy.
- `[defer]` The findings doc's "fully generated-and-owned inventory" option
  (regenerate from Terraform every run) would have prevented both the
  martialops and emit-vision drifts at the source. Left as a design decision
  per the sprint's Out-of-scope note, not done here.
