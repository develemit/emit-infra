import { execa } from 'execa'
import { scrubbedHookEnv } from './gate-doctor-env.js'

export interface TargetResult {
  target: string
  passed: boolean
  errorLine?: string
  timedOut: boolean
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

// Mirrors scripts/hooks/pre-push's run_ci exactly: `format` is special-cased
// to the root prettier script (nx affected -t format matches no projects
// and silently no-ops), everything else runs through nx affected against
// origin/main. Don't change this invocation without changing the hook the
// same way — see sprint 298.
function commandFor(target: string): { file: string; args: string[] } {
  if (target === 'format') return { file: 'pnpm', args: ['format'] }
  return { file: 'pnpm', args: ['nx', 'affected', '-t', target, '--base=origin/main'] }
}

function firstMeaningfulErrorLine(output: string): string | undefined {
  const lines = output.split('\n').map((l) => l.trim()).filter(Boolean)
  return lines.find((l) => /error/i.test(l)) ?? lines[lines.length - 1]
}

/** Runs one declared CI target the way the hook would, in a scrubbed
 * environment, with stdin closed (a target that waits on input must never
 * hang the fleet sweep) and bounded by a timeout. */
export async function runGateTarget(
  repoPath: string,
  target: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<TargetResult> {
  const { file, args } = commandFor(target)
  const result = await execa(file, args, {
    cwd: repoPath,
    env: scrubbedHookEnv(),
    extendEnv: false,
    stdin: 'ignore',
    timeout: timeoutMs,
    reject: false,
  })

  const timedOut = Boolean(result.timedOut)
  const passed = !timedOut && result.exitCode === 0
  const errorLine = passed ? undefined : firstMeaningfulErrorLine(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)

  return errorLine === undefined
    ? { target, passed, timedOut }
    : { target, passed, timedOut, errorLine }
}
