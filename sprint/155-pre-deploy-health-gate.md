# Sprint 155 — Pre-deploy health gate

> _Promoted from observability expansion plan, 2026-07-01._

**Difficulty:** 2

## Goal

Before the deploy SSE stream starts, check whether disk or memory is over threshold (80%). If so, show an inline warning banner with a "Deploy anyway" confirm step rather than silently starting a potentially-doomed deploy.

## Reason

A deploy on a server that's already at 85% disk or memory is likely to fail mid-way or push the server into a bad state. Surfacing this as a pre-flight warning — without blocking the deploy entirely — gives the operator a chance to abort and free space first, while keeping experienced users unblocked with a single extra click.

## Context

- The deploy button is in `apps/dashboard/app/projects/[name]/page.tsx` (line ~96): `onClick={() => setDeploying(true)}`. `status.disk` and `status.memory` are both 0–100 integers already available from `useProjectDetail`.
- `deploying` state controls whether `<DeployPanel>` is rendered (line ~212).
- No new API route needed — the status data is already in scope.
- Pattern: intercept the button click, check thresholds, set a `deployWarning` state string, render a small inline card asking the user to confirm. If the user clicks "Deploy anyway", set `deploying(true)` and clear the warning.

## Tasks

1. Read `apps/dashboard/app/projects/[name]/page.tsx` (around lines 85–120 and 205–220) to understand where the deploy button and `<DeployPanel>` mount.
2. Add `const [deployWarning, setDeployWarning] = useState<string | null>(null)` to the component.
3. Replace the deploy button's `onClick` with a handler that:
   - Clears any existing warning.
   - If `status?.disk >= 80` or `status?.memory >= 80`, sets `deployWarning` to a message like `"Disk at ${status.disk}%, memory at ${status.memory}% — server may be under pressure."` and returns early.
   - Otherwise calls `setDeploying(true)` directly.
4. Render the warning inline (above or below the deploy button area):
   ```tsx
   {deployWarning && !deploying && (
     <div className="rounded-lg border border-warn bg-card p-3 flex items-center gap-3">
       <span className="text-[12px] text-warn font-mono flex-1">{deployWarning}</span>
       <button onClick={() => { setDeployWarning(null); setDeploying(true) }}
         className="px-3 h-[28px] rounded-lg text-[12px] font-medium text-warn border border-warn hover:bg-warn/10 transition-colors shrink-0">
         Deploy anyway
       </button>
       <button onClick={() => setDeployWarning(null)}
         className="text-subtle hover:text-fg shrink-0 text-[12px]">Cancel</button>
     </div>
   )}
   ```
5. Clear `deployWarning` when `deploying` becomes `false` (in the `onClose` callback of `DeployPanel`).
6. Run `pnpm nx typecheck dashboard --skip-nx-cache`. Fix any errors.

## Files involved

- `apps/dashboard/app/projects/[name]/page.tsx` — add `deployWarning` state and guard in the deploy button handler

## Acceptance criteria

- [ ] Clicking Deploy when disk ≥ 80% or memory ≥ 80% shows the warning banner instead of starting the deploy
- [ ] "Deploy anyway" in the banner starts the deploy normally
- [ ] "Cancel" dismisses the banner without deploying
- [ ] Clicking Deploy when conditions are fine still starts immediately (no extra click)
- [ ] `pnpm nx typecheck dashboard --skip-nx-cache` passes clean

## Out of scope

- Per-field threshold configuration (hardcode 80%)
- Blocking the deploy outright (this is a warning, not a gate)
- Checking other conditions beyond disk and memory
