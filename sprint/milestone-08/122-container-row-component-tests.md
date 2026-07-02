# Sprint 122 — Container row component tests

**Difficulty:** 2

## Goal

Write rendering tests for `MobileContainerRow`, `DesktopContainerRow`, and `RestartSparkline` in `container-row.tsx`, which were skipped in sprint 112 due to jsdom concerns.

## Reason

Sprint 112 raised dashboard test coverage to 65% but explicitly excluded `container-row.tsx` because jsdom rendering overhead was expected to be problematic. In practice the project already uses `@testing-library/react` + `jsdom` (via the `happy-dom` vitest environment) for hook tests — adding component render tests here is consistent with existing practice. The container row is a core UI element that handles restart logic, state badge coloring, and a sparkline — all worth pinning with tests.

## Context

- `apps/dashboard/src/components/detail/container-row.tsx` — exports `MobileContainerRow`, `DesktopContainerRow`, `RestartSparkline`, and `ContainerMetrics` type. Also contains `stateBadge` and `buildLabel` (module-private helpers). ~180 lines.
- `apps/dashboard/src/components/detail/container-table.tsx` — consumes the row components; not changed in this sprint.
- `apps/dashboard/vitest.config.ts` — already configured with `happy-dom` environment and `@` path alias (added in sprint 112). Coverage threshold is 65%.
- The component imports `restartContainer` from `@/lib/api` (makes a `POST` fetch) and `useToast` from `@/components/ui/toast`. Both must be mocked.
- `Container` type imported from `@/lib/api` — it has fields: `name`, `state`, `image`, `buildNumber?`, `restartCount`, `createdAt`.

### What to test

**RestartSparkline:**
- Returns `null` when fewer than 2 points
- Returns `null` when all restart counts are 0
- Renders an `<svg>` with a `<polyline>` when data has variance
- Uses `var(--err)` stroke color when restarts increased in the last hour

**MobileContainerRow and DesktopContainerRow:**
- Renders the container name
- Shows the correct badge variant for state: `running` → `ok`, `exited` → `err`, anything else → `warn`
- Shows build number (`#42`) when `buildNumber` is set; falls back to image tag slice otherwise
- Restart button triggers `restartContainer(projectName, containerName)` and calls `onRefetch` after success

### Mock strategy

```ts
vi.mock('@/lib/api', () => ({
  restartContainer: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}))
```

For Link (next/link), the test environment resolves it via the `@` alias config — no explicit mock needed if `happy-dom` is set up correctly. If it fails, add:
```ts
vi.mock('next/link', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
```

## Tasks

1. Read `apps/dashboard/src/components/detail/container-row.tsx` in full to understand all props and exported types.
2. Read `apps/dashboard/vitest.config.ts` to confirm the environment and alias config.
3. Create `apps/dashboard/src/components/detail/container-row.test.tsx` with:
   - ≥3 tests for `RestartSparkline`
   - ≥3 tests for `MobileContainerRow`
   - ≥2 tests for `DesktopContainerRow`
4. Run `pnpm nx test dashboard --skip-nx-cache`. Fix any failures. Coverage threshold must still pass.

## Files involved

- new file: `apps/dashboard/src/components/detail/container-row.test.tsx`

## Acceptance criteria

- [x] `container-row.test.tsx` exists with ≥8 tests total across the three exported components
- [x] `RestartSparkline` tests cover null cases and renders-with-data case
- [x] `MobileContainerRow` and `DesktopContainerRow` tests cover state badge and build label rendering
- [x] `pnpm nx test dashboard --skip-nx-cache` passes with all existing + new tests green

## Completed

**Date:** 2026-06-29

### Summary
Created `container-row.test.tsx` with 20 tests across three describe blocks. `RestartSparkline` gets 5 tests (null cases: insufficient points, all zeros; render cases: with variance, stroke color `var(--err)` on recent increase). `MobileContainerRow` gets 8 tests and `DesktopContainerRow` gets 7 tests — covering name rendering, badge variant mapping (`running`→`ok`, `exited`→`err`, other→`warn`), build label vs image-tag fallback, and restart button triggering `restartContainer` + `onRefetch`. Added an explicit `React` import to `container-row.tsx` for jsdom/vitest JSX compatibility.

### Files changed
- (new) `apps/dashboard/src/components/detail/container-row.test.tsx` — 20 tests for RestartSparkline, MobileContainerRow, DesktopContainerRow
- `apps/dashboard/src/components/detail/container-row.tsx` — added explicit React import for test environment compatibility

### Verification
- `pnpm nx test dashboard --skip-nx-cache`: 49/49 pass (7 test files)

### Follow-ups
- none

## Out of scope

- Visual regression / screenshot tests
- Testing the `container-table.tsx` wrapper
- Testing private helpers `stateBadge` and `buildLabel` directly (test them via component output)
