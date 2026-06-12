# Sprint 45 — revokeR2Token: Accept Logger Parameter

> _Promoted from sprint-38 follow-up [defer], 2026-06-12._

## Goal

Replace the hardcoded `console.warn` in `revokeR2Token()` with an optional logger
parameter so callers can route failure messages through their own output channel.

## Context

`packages/core/src/r2.ts` exports `revokeR2Token()`. When the revoke API call
fails it currently calls `console.warn(...)`. In a library module this is a bad
pattern — the caller (e.g. the CLI `setup.ts` spinner context) should control
whether/how the warning is surfaced, and unit tests should be able to suppress it.

The fix is a small signature change:

```ts
// before
async function revokeR2Token(tokenId: string, apiToken: string): Promise<void>

// after
async function revokeR2Token(
  tokenId: string,
  apiToken: string,
  logger?: (msg: string) => void,
): Promise<void>
```

Inside the function, replace every `console.warn(...)` with `logger?.(...)`.

The one caller in `apps/cli/src/commands/setup.ts` already wraps the revoke in a
try/catch that passes a spinner-aware warning; update it to pass a logger that
calls `spinner.warn(msg)` (or `console.warn` if no spinner is in scope —
check the call site).

## Tasks

1. Read `packages/core/src/r2.ts` — find `revokeR2Token` and note every
   `console.warn` call inside it.
2. Update the function signature to add `logger?: (msg: string) => void` as a
   third parameter.
3. Replace each `console.warn(...)` in the function body with `logger?.(...)`.
4. Read `apps/cli/src/commands/setup.ts` — find the `revokeR2Token(...)` call
   site. Pass a logger that writes through the existing spinner/console
   mechanism already used in that block.
5. Run `pnpm nx run cli:typecheck` — confirm clean.

## Acceptance criteria

- [x] `revokeR2Token` signature includes `logger?: (msg: string) => void`
- [x] No `console.warn` calls remain inside `revokeR2Token`
- [x] The call site in `setup.ts` passes a logger (not left as `undefined`)
- [x] `pnpm nx run cli:typecheck` clean

## Completed

**Date:** 2026-06-12

### Summary
Added `logger?: (msg: string) => void` as a third parameter to `revokeR2Token` in `packages/core/src/r2.ts`. Replaced both `console.warn` calls inside the function with `logger?.(...)`. Updated all three call sites in `setup.ts` to pass the module-level `warn` helper (chalk yellow + ⚠ prefix) so the detailed API error message flows through the same styled output channel as the rest of the setup step output.

### Files changed
- `packages/core/src/r2.ts` — added `logger?` param, replaced 2× `console.warn` with `logger?.()`
- `apps/cli/src/commands/setup.ts` — passed `warn` as logger at all 3 `revokeR2Token` call sites

### Verification
- `pnpm nx run cli:typecheck`: clean
- Code review: no `console.warn` remains in `revokeR2Token`
- Code review: all 3 call sites pass `warn`

### Follow-ups
none
