import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@emit-infra/core', () => ({
  deployRecordInit: vi.fn().mockResolvedValue({ sha: 'init-sha' }),
  deployRecordDone: vi.fn().mockResolvedValue(undefined),
  gitField: vi.fn().mockResolvedValue('head-sha'),
}))

import { deployRecordInit, deployRecordDone } from '@emit-infra/core'
import { beginDeployRecord } from './deploy-record-owner.js'

describe('beginDeployRecord', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes the CLI record for a direct deploy', async () => {
    const rec = await beginDeployRecord('/cwd', {})
    await rec.finish('deployed', { deploy: 3 }, true)

    expect(rec.sha).toBe('init-sha')
    expect(deployRecordInit).toHaveBeenCalledOnce()
    expect(deployRecordDone).toHaveBeenCalledWith('/cwd', expect.anything(), 'deployed', { deploy: 3 }, true)
  })

  it('leaves the push\'s single record to the hook when it owns it', async () => {
    const rec = await beginDeployRecord('/cwd', { EMIT_DEPLOY_RECORD_OWNER: 'hook' })
    await rec.finish('deployed', {}, false)

    expect(rec.sha).toBe('head-sha')
    expect(deployRecordInit).not.toHaveBeenCalled()
    expect(deployRecordDone).not.toHaveBeenCalled()
  })
})
