# Add unit tests for the packages/core command executors
**Difficulty:** 3

## Goal
`packages/core` gains test coverage for its three command executors — `ssh.ts`, `ansible.ts`, `terraform.ts` — asserting the exact argument arrays passed to `execa` and the error behavior on non-zero exits. This is the code every deploy, provision, rollback, and status poll flows through, and it currently has zero tests.

## Reason
The 2026-07-05 codebase audit graded test coverage C specifically because the riskiest code is the least tested: these executors hold the SSH keys to production servers running real apps (tastease, emit-vision) with real user data. A regression in arg construction here (e.g. a flag reordered, a command accidentally concatenated into the host arg) hits production with no reviewer to catch it. Arg-array assertions also double as injection-regression protection: they prove commands stay in discrete array elements and never pass through a shell.

## Context
- Test runner: vitest 3 (root devDependency). `packages/core/project.json` already has a `test` target (nx run-commands) — check its command; if it needs a vitest config or the target is a placeholder, add a minimal `vitest.config.ts` in `packages/core` matching how `apps/api` runs its tests. Run via `pnpm nx run core:test`.
- Mocking convention (copy from `apps/api/src/routes/deploy.test.ts`):
  ```ts
  vi.mock('execa', () => ({ execa: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }) }))
  ```
  Then `import { execa } from 'execa'` and assert with `vi.mocked(execa)`.
- `ssh.ts` (45 lines): `sshExec(host, command, keyPath)` calls `execa('ssh', [...])` where the array is: `-i keyPath`, `-o StrictHostKeyChecking=no`, `-o ConnectTimeout=10`, `-o BatchMode=yes`, then `...sshMuxArgs()` (ControlMaster/ControlPath/ControlPersist options), then `root@${host}`, then `command` as the final single element. Note the module has import-time side effects (`mkdirSync` of `~/.ssh/emit-infra-cm`) — wrapped in try/catch, safe under test, but be aware it runs on import. `sshMuxArgs()` is exported and can be asserted directly (6 elements, ControlPath under the control dir, `ControlPersist=60`).
- `ansible.ts` (35 lines): `runAnsible(playbook, inventory, extraVars?, onLine?)`. Assert: args are `[<ansibleDir>/playbooks/<playbook>.yml, '-i', inventory]` plus `['--extra-vars', JSON.stringify(extraVars)]` when extraVars given; env includes `ANSIBLE_HOST_KEY_CHECKING: 'False'`. Two paths: without `onLine` it uses `stdio: 'inherit'`; with `onLine` it pipes stdout/stderr through `readline` and throws `ansible-playbook exited with code N` when `exitCode !== 0`. For the streaming path, have the mocked `execa` return a thenable fake process whose `stdout`/`stderr` are `Readable.from([...lines])` streams and which resolves to `{ exitCode: 0 }` — assert `onLine` received each line with the right stream tag. Also test the non-zero exit throw (resolve to `{ exitCode: 2 }`).
- `terraform.ts` (29 lines): `runTerraform(cmd, args, cwd, onLine?)` — same shape as ansible (assert `['terraform', [cmd, ...args]]`, `cwd` option, non-zero throw). `getTerraformOutput(key, cwd)` calls `execa('terraform', ['output', '-raw', key], { cwd })` and returns `stdout.trim()` — test the trim.
- Keep test files co-located: `packages/core/src/ssh.test.ts`, `ansible.test.ts`, `terraform.test.ts`.

## Tasks
1. Confirm/wire the `core:test` Nx target so vitest picks up `packages/core/src/**/*.test.ts` (add minimal `vitest.config.ts` only if needed).
2. Write `ssh.test.ts`: exact arg-array assertion for `sshExec` (order matters; command is one element, host is `root@<host>`), stdout passthrough, and `sshMuxArgs()` shape.
3. Write `ansible.test.ts`: playbook path + inventory args, `--extra-vars` JSON serialization, `ANSIBLE_HOST_KEY_CHECKING=False` env, streaming `onLine` line delivery for both streams, throw on non-zero exit.
4. Write `terraform.test.ts`: arg construction with `cwd`, streaming + non-zero throw, `getTerraformOutput` raw-output trim.
5. Run `pnpm nx run core:test` and the full `pnpm nx run-many -t typecheck lint` to confirm green.

## Files involved
- `packages/core/src/ssh.ts` — read-only reference (do not modify)
- `packages/core/src/ansible.ts` — read-only reference
- `packages/core/src/terraform.ts` — read-only reference
- new file: `packages/core/src/ssh.test.ts`
- new file: `packages/core/src/ansible.test.ts`
- new file: `packages/core/src/terraform.test.ts`
- possibly `packages/core/project.json` / new `packages/core/vitest.config.ts` — only if the test target isn't already runnable

## Acceptance criteria
- [x] `ssh.test.ts` asserts the full ssh arg array element-by-element, proving host and command are separate array elements
- [x] `ansible.test.ts` covers extra-vars JSON, env flag, streaming onLine, and non-zero exit throw
- [x] `terraform.test.ts` covers arg construction, cwd, non-zero throw, and output trim
- [x] `pnpm nx run core:test` passes; typecheck and lint clean
- [x] No production source files modified (tests only, plus test wiring if required)

## Out of scope
- Testing other `packages/core` modules (r2.ts, etc.) — separate effort if wanted
- Route-level tests for the API (sprint 206)
- Any refactor of the executors themselves, even if tests reveal awkward seams — note in Follow-ups instead

## Completed

**Date:** 2026-07-05

### Summary
Added unit tests for all three `packages/core` command executors (`ssh.ts`, `ansible.ts`, `terraform.ts`). Tests assert exact argument arrays passed to `execa`, proving host/command separation (injection safety), env flags, streaming line delivery via `onLine` callbacks, and error throws on non-zero exits. Also wired the `core:test` Nx target to a new `vitest.config.ts` so tests are scoped to this package.

### Files changed
- (new) `packages/core/vitest.config.ts` — minimal vitest config scoping tests to `packages/core/src/**/*.test.ts`
- (new) `packages/core/src/ssh.test.ts` — 5 tests: sshMuxArgs shape, full arg-array assertion, stdout passthrough, command-as-single-element, host prefix
- (new) `packages/core/src/ansible.test.ts` — 6 tests: playbook path/inventory, extra-vars JSON, env flag, stdio inherit, streaming onLine, non-zero throw
- (new) `packages/core/src/terraform.test.ts` — 6 tests: cmd+args+cwd, stdio inherit, streaming onLine, non-zero throw, getTerraformOutput args, trim
- `packages/core/project.json` — added `--config` flag to test target command
- `packages/core/tsconfig.json` — added `vitest.config.ts` to include array for lint/typecheck

### Verification
- `pnpm nx run core:test`: 17/17 pass
- `pnpm nx run core:typecheck`: clean
- `pnpm nx run core:lint`: clean

### Follow-ups
- `[defer]` The streaming mock pattern (thenable process with Readable.from streams) could be extracted to a shared test helper if future test sprints repeat it
- `[defer]` `sshExec` doesn't throw on non-zero exit (execa's default reject behavior handles it) — worth a test if reject semantics are ever customized
