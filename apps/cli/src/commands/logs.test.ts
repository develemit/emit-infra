import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Command } from 'commander'
import { buildLogsScript, registerLogs } from './logs.js'

vi.mock('@emit-infra/core', () => ({
  loadConfig: vi.fn(),
  sshExec: vi.fn(),
  getTerraformOutput: vi.fn(),
}))

import { loadConfig, sshExec } from '@emit-infra/core'

const baseConfig = {
  name: 'test-project',
  domain: 'test.com',
  sshKeyName: 'emit-deploy',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(loadConfig).mockReturnValue(baseConfig as ReturnType<typeof loadConfig>)
  vi.mocked(sshExec).mockResolvedValue('log output')
})

describe('buildLogsScript', () => {
  it('single container — default lines, no since, no errors', () => {
    const script = buildLogsScript('myapp', '100', undefined, false)
    expect(script).toBe('docker logs --tail 100 myapp 2>&1')
  })

  it('single container with --since', () => {
    const script = buildLogsScript('myapp', '100', '1h', false)
    expect(script).toBe('docker logs --tail 100 --since 1h myapp 2>&1')
  })

  it('single container with --errors: uses 500 lines and grep filter', () => {
    const script = buildLogsScript('myapp', '100', undefined, true)
    expect(script).toBe("docker logs --tail 500 myapp 2>&1 | grep -iE 'error|warn|fatal|exception|panic|traceback'")
  })

  it('single container with --errors and --since', () => {
    const script = buildLogsScript('myapp', '100', '30m', true)
    expect(script).toBe("docker logs --tail 500 --since 30m myapp 2>&1 | grep -iE 'error|warn|fatal|exception|panic|traceback'")
  })

  it('all containers — no container specified', () => {
    const script = buildLogsScript(undefined, '50', undefined, false)
    expect(script).toBe(
      "docker ps --format '{{.Names}}' | while read name; do echo \"=== $name ===\"; docker logs --tail 50 $name 2>&1; done",
    )
  })

  it('all containers with --since', () => {
    const script = buildLogsScript(undefined, '100', '2h', false)
    expect(script).toContain('--since 2h')
    expect(script).toContain("while read name")
  })

  it('all containers with --errors: appends grep to inner command', () => {
    const script = buildLogsScript(undefined, '100', undefined, true)
    expect(script).toContain("grep -iE 'error|warn|fatal|exception|panic|traceback'")
    expect(script).toContain("while read name")
  })
})

describe('logs command', () => {
  it('calls sshExec with --host override and built script', async () => {
    const program = new Command()
    program.exitOverride()
    registerLogs(program)
    await program.parseAsync(['node', 'cli', 'logs', 'web', '--host', '1.2.3.4'])

    expect(vi.mocked(sshExec)).toHaveBeenCalledOnce()
    const [calledHost, calledScript] = vi.mocked(sshExec).mock.calls[0]!
    expect(calledHost).toBe('1.2.3.4')
    expect(calledScript).toBe('docker logs --tail 100 web 2>&1')
  })

  it('passes --lines and --since to the script', async () => {
    const program = new Command()
    program.exitOverride()
    registerLogs(program)
    await program.parseAsync(['node', 'cli', 'logs', 'api', '--host', '1.2.3.4', '--lines', '200', '--since', '30m'])

    const [, script] = vi.mocked(sshExec).mock.calls[0]!
    expect(script).toBe('docker logs --tail 200 --since 30m api 2>&1')
  })

  it('--errors flag passes errors=true to buildLogsScript', async () => {
    const program = new Command()
    program.exitOverride()
    registerLogs(program)
    await program.parseAsync(['node', 'cli', 'logs', 'api', '--host', '1.2.3.4', '--errors'])

    const [, script] = vi.mocked(sshExec).mock.calls[0]!
    expect(script).toContain('--tail 500')
    expect(script).toContain("grep -iE 'error|warn|fatal|exception|panic|traceback'")
  })
})
