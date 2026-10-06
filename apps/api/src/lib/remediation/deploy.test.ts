import { describe, it, expect } from 'vitest'
import { remediate } from './index.js'
import { classifyDeployError } from './deploy.js'

const deploy = (error: string, sha = 'a1b2c3d4e5f6') => remediate({ kind: 'deploy-failed', project: 'martialops', sha, error })
const commands = (error: string) => deploy(error).steps.map((s) => s.command ?? '')

describe('deploy failure remediation', () => {
  const ts = 'docker build failed\nerror TS2322: Type string is not assignable to type number.'

  it('a TypeScript build error suggests no rollback', () => {
    expect(classifyDeployError(ts)).toBe('build')
    expect(commands(ts).some((c) => c.includes('rollback'))).toBe(false)
    expect(deploy(ts).steps[0]!.text).toContain('no rollback needed')
    expect(deploy(ts).steps[0]!.command).toContain('pnpm typecheck')
  })

  it('a registry error says to re-push', () => {
    const r = deploy('failed to pull: TLS handshake timeout')
    expect(classifyDeployError('failed to pull: TLS handshake timeout')).toBe('transient')
    expect(r.steps[0]!.text).toContain('Re-push')
    expect(commands('TLS handshake timeout').some((c) => c.includes('rollback'))).toBe(false)
  })

  it('a post-switch health failure makes rollback the first step', () => {
    const r = deploy('health check failed after switch')
    expect(r.urgency).toBe('now')
    expect(r.steps[0]!.command).toBe('emit-infra rollback martialops')
  })

  it('points at the deploy log the pipeline writes, not the history file', () => {
    const all = commands(ts).join(' ')
    expect(all).toContain('/tmp/emit-deploy-martialops-a1b2c3d.log')
    expect(all).not.toContain('.deploy-history')
  })

  it('falls back to the newest log when the sha is unknown', () => {
    expect(commands(ts).length).toBeGreaterThan(0)
    expect(deploy(ts, 'unknown').steps[1]!.command).toContain('ls -t /tmp/emit-deploy-martialops-*.log')
  })

  it('unrecognised errors check status before suggesting rollback', () => {
    expect(commands('something odd')[1]).toBe('emit-infra status martialops')
  })
})
