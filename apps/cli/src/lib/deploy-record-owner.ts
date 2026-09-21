import { deployRecordInit, deployRecordDone, gitField } from '@emit-infra/core'

export interface DeployRecorder {
  sha: string
  finish(status: 'deployed' | 'failed', phases: Record<string, number>, isBuildBaseline: boolean): Promise<void>
}

// The pre-push hook writes the authoritative record for a push (it knows what
// it built or re-tagged) and exports this before invoking the CLI. A second
// CLI-written record for the same sha could only ever say isBuildBaseline:false
// beside the hook's true, so one push must yield exactly one record.
export const RECORD_OWNER_ENV = 'EMIT_DEPLOY_RECORD_OWNER'

export async function beginDeployRecord(cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<DeployRecorder> {
  if (env[RECORD_OWNER_ENV] === 'hook') {
    return { sha: await gitField(cwd, ['rev-parse', 'HEAD']), finish: async () => {} }
  }
  const ctx = await deployRecordInit(cwd)
  return {
    sha: ctx.sha,
    finish: (status, phases, isBuildBaseline) => deployRecordDone(cwd, ctx, status, phases, isBuildBaseline),
  }
}
