# DX: Add Explicit Return Types to api.ts Fetch Functions
**Difficulty:** 2

## Goal
Annotate all ~20 async fetch functions in `apps/dashboard/src/lib/api.ts` with explicit `Promise<T>` return types.

## Reason
Inferred return types make the API contract implicit. When a fetch function silently returns a widened type due to a structural change in the interface, TypeScript won't catch it at the definition — only at call sites, often with confusing errors. Explicit return types also improve IDE navigation: `go to definition` on a function shows the declared shape immediately rather than requiring hover inspection.

## Context
- `apps/dashboard/src/lib/api.ts` — currently ~645 lines with ~20 exported async functions. Most interfaces are already defined in the same file. The task is to add `: Promise<TheInterface>` (or `: Promise<TheInterface | null>`) to each function signature where missing.
- Common patterns to look for:
  - `export async function getFoo(name: string) {` → `export async function getFoo(name: string): Promise<FooData>`
  - Functions that return `null` on 404 → `Promise<FooData | null>`
  - Functions that return arrays → `Promise<FooItem[]>`
- Do not reorganize the file structure — that's sprint 172. Only add return type annotations.
- If TypeScript infers a return type that conflicts with the intended declared type, fix the mismatch (these are latent bugs worth catching).

## Tasks
1. Read `api.ts` in full to list all exported async functions.
2. For each function, identify the correct return type from the returned interface or existing usage.
3. Add `: Promise<T>` annotations to all async function signatures that lack them.
4. Run `npx tsc --noEmit` to confirm all annotations are correct. Fix any type mismatches that surface.

## Files involved
- `apps/dashboard/src/lib/api.ts` — add explicit return type annotations to all exported async functions

## Acceptance criteria
- [x] Every exported async function has an explicit `: Promise<T>` return type annotation
- [x] No `Promise<any>` or `Promise<unknown>` where a concrete type exists
- [x] Typecheck passes with no new errors (resolve any mismatches found)

## Out of scope
- Splitting api.ts into domain modules (sprint 172)
- Adding return types to non-async or non-exported helpers
- Changing any function behavior

## Completed

**Date:** 2026-07-01

### Summary
On reading `api.ts` in full, all ~20 exported async functions already carry explicit `: Promise<T>` return type annotations — the file was already compliant. This sprint was planned against an earlier version of the file; subsequent sprint work (or prior annotation passes) had already addressed it. No source changes were required. Typecheck confirmed clean across all 5 packages.

### Files changed
- `sprint/169-dx-explicit-return-types.md` — sprint file only (no source changes needed)

### Verification
- typecheck: clean (all 5 packages pass, cached)

### Follow-ups
- none
