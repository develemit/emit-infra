import { execa } from 'execa'

export type DockerInspectFn = (containerName: string) => Promise<string | null>

// A container's name (or its credentials, per the study-haul/math-problemizer
// case) can mislead about which repo it belongs to. The compose project's
// `working_dir` label is set by `docker compose up` itself and can't drift
// from the truth the way a name can.
export async function dockerInspectWorkingDir(containerName: string): Promise<string | null> {
  try {
    const result = await execa('docker', [
      'inspect', containerName,
      '--format', '{{index .Config.Labels "com.docker.compose.project.working_dir"}}',
    ])
    const workingDir = result.stdout.trim()
    return workingDir.length > 0 ? workingDir : null
  } catch {
    return null // not running, doesn't exist, or docker itself unavailable
  }
}

export type OwnershipResult = 'owned' | 'mismatch' | 'not-running'

/**
 * Confirms a named container actually belongs to `repoPath` before a report
 * attributes it there. `inspect` is injectable so callers can unit-test the
 * mismatch/not-running paths without Docker.
 */
export async function verifyContainerOwnership(
  repoPath: string,
  containerName: string | null,
  inspect: DockerInspectFn = dockerInspectWorkingDir,
): Promise<OwnershipResult> {
  if (!containerName) return 'not-running'
  const workingDir = await inspect(containerName)
  if (workingDir === null) return 'not-running'
  return workingDir === repoPath ? 'owned' : 'mismatch'
}
