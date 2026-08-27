# Resource gate

`scripts/resource-gate.sh` — a machine-wide gate for resource-heavy work:
full e2e suites, sprint children, anything that can starve every other
process on the box.

## Why it exists

2026-08-26: a tastease sprint ran its full Playwright suite while other work
was already hot. The develemit-hq dev server's event loop starved, its
supervisor read the missed health probes as death, killed the server's whole
process tree — taking the very agent sessions running the suite down with it —
and the restart loop orphaned more processes on top.

Every child had made a locally reasonable decision. Nobody saw the sum. The
gate is where the sum lives.

## Two composable ideas

1. **A check** — is the machine calm enough to start heavy work *right now*?
   Signals: 1-minute load per core (busy ≥ 1.5, critical ≥ 3.0), macOS memory
   pressure (`kern.memorystatus_vm_pressure_level`: 2 = busy, 4 = critical),
   and how many e2e/test suites are already running machine-wide (2 = busy,
   4 = critical).
2. **A semaphore** — at most N heavy jobs of a given tag at once, machine-wide
   (default 2 slots). Slots live in `/tmp/emit-resource-gate/<tag>/slot-N`,
   each holding its owner's pid. A slot whose owner is dead is debris from a
   crash and self-reclaims on the next acquire — a killed sprint can never
   wedge the gate.

## Usage

```bash
scripts/resource-gate.sh check                       # one-shot; exit 0 ok / 1 busy / 2 critical
scripts/resource-gate.sh wait --timeout 300          # retry until calm or timeout
scripts/resource-gate.sh acquire e2e --timeout 900   # calm + slot; prints slot path
scripts/resource-gate.sh release "$SLOT"
scripts/resource-gate.sh status                      # signals + who holds what
```

The canonical heavy-suite pattern — one shell owns the slot for the suite's
whole lifetime:

```bash
GATE=~/projects/emit-infra/scripts/resource-gate.sh
SLOT=$(GATE_OWNER_PID=$$ "$GATE" acquire e2e --timeout 900) || exit 1
pnpm test:e2e; rc=$?
GATE_OWNER_PID=$$ "$GATE" release "$SLOT"
exit $rc
```

`GATE_OWNER_PID=$$` matters: the CLI is a transient subprocess, so without it
the slot would be owned by a pid that dies the moment acquire returns, and the
next acquirer would reclaim it mid-suite. Pin ownership to the shell that runs
the suite; if that shell is killed, the slot self-reclaims — crash-safety and
correctness from the same mechanism.

## Semantics worth knowing

- **`busy` still acquires a slot.** The semaphore itself is the protection; a
  merely-busy machine is not helped by queueing forever. Only `critical`
  refuses outright.
- **`wait` vs `acquire`**: `wait` is for orchestrators that just want to not
  *start* new work into a storm (e.g. `/start-sprint-auto` before launching a
  child). `acquire` is for the process that will itself be the storm.
- Missing probes (no sysctl) classify as `ok`, not as failure — this script
  gates work, and an unmeasurable machine must not halt all sprints. The
  dashboard's machine-health system is the layer that alarms on blind probes.
- Thresholds are deliberately loose. The gate catches pile-ups, not busy
  Chrome tabs; false "stop" costs more than false "go" here because the
  dashboard health watch (develemit-hq) alarms on genuine storms within
  10 minutes anyway.

## Consumers

- `~/.claude/commands/start-sprint.md` — acquires an `e2e` slot around full
  test-suite verification.
- `~/.claude/commands/start-sprint-auto.md` — `wait`s before launching each
  sprint child; a machine stuck at critical stops the loop with
  `machine_busy`.

## Tests

`bash scripts/lib/resource-gate.test.sh` — wired into `pnpm test:hooks`.
Deterministic via the `RGATE_FORCE_LOAD` / `RGATE_FORCE_CORES` /
`RGATE_FORCE_PRESSURE` / `RGATE_FORCE_HEAVY` env seams.
