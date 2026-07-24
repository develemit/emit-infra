import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Command } from 'commander'
import { join } from 'node:path'
import { buildDeployExtraVars, computeEnvRemoval, enforceEnvRemovalGuard, registerDeploy } from './deploy.js'

vi.mock('@emit-infra/core', () => ({
  loadConfig: vi.fn(),
  runAnsible: vi.fn(),
  sshExec: vi.fn(),
}))

vi.mock('./configure.js', () => ({
  resolveInventoryPath: vi.fn().mockResolvedValue('/fake/inventory.ini'),
}))

import { loadConfig, runAnsible, sshExec } from '@emit-infra/core'

const baseConfig = {
  name: 'test-project',
  domain: 'test.com',
  region: 'nbg1' as const,
  serverType: 'cx22',
  sshKeyName: 'emit-deploy',
  github: { repo: 'user/test' },
}

const deployConfig = {
  composeSrc: 'docker-compose.prod.yml',
  composeDest: 'docker-compose.yml',
  appDir: '/app',
  extraFiles: [] as { src: string; dest: string }[],
  postDeployExec: [] as { service: string; command: string }[],
}

describe('buildDeployExtraVars — standard strategy', () => {
  it('sets project_name, compose_src, compose_dest', () => {
    const config = { ...baseConfig, deploy: deployConfig }
    const vars = buildDeployExtraVars(config, '/cwd', {}, () => false)

    expect(vars.project_name).toBe('test-project')
    expect(vars.compose_src).toBe('/cwd/docker-compose.prod.yml')
    expect(vars.compose_dest).toBe('docker-compose.yml')
    expect(vars.blue_green).toBeUndefined()
  })

  it('includes build_number when BUILD_NUMBER is set', () => {
    const config = { ...baseConfig, deploy: deployConfig }
    const vars = buildDeployExtraVars(config, '/cwd', { BUILD_NUMBER: '99' }, () => false)

    expect(vars.build_number).toBe('99')
  })

  it('omits build_number when BUILD_NUMBER is absent', () => {
    const config = { ...baseConfig }
    const vars = buildDeployExtraVars(config, '/cwd', {}, () => false)

    expect(vars.build_number).toBeUndefined()
  })

  it('sets env_src when an env file candidate exists', () => {
    const config = { ...baseConfig, deploy: deployConfig }
    const existsFn = vi.fn((p: string) => p.endsWith('.env.prod'))
    const vars = buildDeployExtraVars(config, '/cwd', {}, existsFn)

    expect(vars.copy_env).toBe(true)
    expect(vars.env_src).toBe('/cwd/.env.prod')
  })

  it('skips env_src when no env file candidate exists', () => {
    const config = { ...baseConfig, deploy: deployConfig }
    const vars = buildDeployExtraVars(config, '/cwd', {}, () => false)

    expect(vars.copy_env).toBeUndefined()
    expect(vars.env_src).toBeUndefined()
  })

  it('sets GHCR credentials from env', () => {
    const config = { ...baseConfig }
    const vars = buildDeployExtraVars(config, '/cwd', { GHCR_TOKEN: 'tok', GHCR_ACTOR: 'actor' }, () => false)

    expect(vars.ghcr_token).toBe('tok')
    expect(vars.ghcr_actor).toBe('actor')
  })
})

describe('buildDeployExtraVars — nginx.syncOnDeploy', () => {
  it('omits nginx_custom_config_src when syncOnDeploy is unset', () => {
    const config = {
      ...baseConfig,
      deploy: deployConfig,
      nginx: { wildcardCert: false, syncOnDeploy: false, customConfigSrc: 'nginx/vhost.conf' },
    }
    const vars = buildDeployExtraVars(config, '/cwd', {}, () => false)

    expect(vars.nginx_custom_config_src).toBeUndefined()
  })

  it('omits nginx_custom_config_src when syncOnDeploy is false', () => {
    const config = {
      ...baseConfig,
      deploy: deployConfig,
      nginx: { wildcardCert: false, syncOnDeploy: false, customConfigSrc: 'nginx/vhost.conf' },
    }
    const vars = buildDeployExtraVars(config, '/cwd', {}, () => false)

    expect(vars.nginx_custom_config_src).toBeUndefined()
  })

  it('omits nginx_custom_config_src when syncOnDeploy is true but customConfigSrc is missing', () => {
    const config = {
      ...baseConfig,
      deploy: deployConfig,
      nginx: { wildcardCert: false, syncOnDeploy: true },
    }
    const vars = buildDeployExtraVars(config, '/cwd', {}, () => false)

    expect(vars.nginx_custom_config_src).toBeUndefined()
  })

  it('sets nginx_custom_config_src joined to cwd when syncOnDeploy is true and customConfigSrc is set', () => {
    const config = {
      ...baseConfig,
      deploy: deployConfig,
      nginx: { wildcardCert: false, syncOnDeploy: true, customConfigSrc: 'nginx/vhost.conf' },
    }
    const vars = buildDeployExtraVars(config, '/cwd', {}, () => false)

    expect(vars.nginx_custom_config_src).toBe(join('/cwd', 'nginx/vhost.conf'))
  })
})

describe('buildDeployExtraVars — blue-green with separate structure', () => {
  const bgConfig = {
    ...baseConfig,
    deploy: deployConfig,
    blueGreen: {
      composeStructure: 'separate' as const,
      services: [
        { name: 'web', bluePort: 3000, greenPort: 3001, healthPath: '/healthz' },
        { name: 'api', bluePort: 4000, greenPort: 4001 },
      ],
    },
  }

  it('includes all three compose files when app.yml exists', () => {
    const vars = buildDeployExtraVars(bgConfig, '/cwd', {}, () => true)

    expect(vars.blue_green).toBe(true)
    expect(vars.blue_green_compose_files).toEqual([
      join('/cwd', 'docker-compose.app.yml'),
      join('/cwd', 'docker-compose.blue.yml'),
      join('/cwd', 'docker-compose.green.yml'),
    ])
  })

  it('filters out app.yml when it does not exist (develemail case)', () => {
    const existsFn = (p: string) => !p.includes('docker-compose.app.yml')
    const vars = buildDeployExtraVars(bgConfig, '/cwd', {}, existsFn)

    expect(vars.blue_green_compose_files).toHaveLength(2)
    expect((vars.blue_green_compose_files as string[]).every(f => !f.includes('app.yml'))).toBe(true)
  })

  it('sets bg_services, bg_ports, and bg_health_checks correctly', () => {
    const vars = buildDeployExtraVars(bgConfig, '/cwd', {}, () => true)

    expect(vars.bg_services).toBe('web api')
    expect(vars.bg_ports_blue).toBe('3000 4000')
    expect(vars.bg_ports_green).toBe('3001 4001')
    expect(vars.bg_health_checks).toBe('/healthz skip')
  })

  it('clears post_deploy_exec and sets bg_post_exec for blue-green', () => {
    const config = {
      ...bgConfig,
      deploy: {
        ...deployConfig,
        postDeployExec: [{ service: 'api', command: 'pnpm migrate' }],
      },
    }
    const vars = buildDeployExtraVars(config, '/cwd', {}, () => true)

    expect(vars.post_deploy_exec).toBeUndefined()
    expect(vars.bg_post_exec).toBe('api:pnpm migrate')
  })
})

describe('computeEnvRemoval', () => {
  it('returns server keys absent from local keys', () => {
    expect(computeEnvRemoval(['A', 'B'], ['A', 'B', 'C'])).toEqual(['C'])
  })

  it('excludes BUILD_NUMBER from the removal set', () => {
    expect(computeEnvRemoval(['A'], ['A', 'BUILD_NUMBER'])).toEqual([])
  })

  it('returns an empty set when local keys are a superset of server keys', () => {
    expect(computeEnvRemoval(['A', 'B', 'C'], ['A', 'B'])).toEqual([])
  })

  it('returns an empty set for a first deploy with no server keys', () => {
    expect(computeEnvRemoval(['A', 'B'], [])).toEqual([])
  })

  it('sorts the returned keys', () => {
    expect(computeEnvRemoval([], ['ZKEY', 'AKEY'])).toEqual(['AKEY', 'ZKEY'])
  })
})

describe('enforceEnvRemovalGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('proceeds silently when the server has no keys absent from local', async () => {
    vi.mocked(sshExec).mockResolvedValue('A\nB\n')

    await enforceEnvRemovalGuard({
      host: 'host',
      sshKey: '/key',
      projectName: 'proj',
      envSrc: '/cwd/.env',
      localKeys: ['A', 'B', 'C'],
      allowEnvRemoval: false,
    })

    expect(sshExec).toHaveBeenCalledWith('host', expect.stringContaining('/opt/proj/.env'), '/key')
  })

  it('does not block a first deploy with no existing server .env', async () => {
    vi.mocked(sshExec).mockResolvedValue('')

    await expect(
      enforceEnvRemovalGuard({
        host: 'host',
        sshKey: '/key',
        projectName: 'proj',
        envSrc: '/cwd/.env',
        localKeys: ['A'],
        allowEnvRemoval: false,
      }),
    ).resolves.toBeUndefined()
  })

  it('aborts non-zero and lists removed keys when --allow-env-removal is not passed', async () => {
    vi.mocked(sshExec).mockResolvedValue('A\nB\nSECRET\n')
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      enforceEnvRemovalGuard({
        host: 'host',
        sshKey: '/key',
        projectName: 'proj',
        envSrc: '/cwd/.env',
        localKeys: ['A', 'B'],
        allowEnvRemoval: false,
      }),
    ).rejects.toThrow('process.exit')

    expect(exitSpy).toHaveBeenCalledWith(1)
    const errorText = errorSpy.mock.calls.map(c => c.join(' ')).join('\n')
    expect(errorText).toContain('SECRET')
    expect(errorText).toContain('/cwd/.env')
    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('proceeds with a warning naming the removed keys when --allow-env-removal is passed', async () => {
    vi.mocked(sshExec).mockResolvedValue('A\nB\nSECRET\n')
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await enforceEnvRemovalGuard({
      host: 'host',
      sshKey: '/key',
      projectName: 'proj',
      envSrc: '/cwd/.env',
      localKeys: ['A', 'B'],
      allowEnvRemoval: true,
    })

    expect(exitSpy).not.toHaveBeenCalled()
    const warnText = warnSpy.mock.calls.map(c => c.join(' ')).join('\n')
    expect(warnText).toContain('SECRET')
    exitSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it('prints the resolved env_src and a local/server key-count delta', async () => {
    vi.mocked(sshExec).mockResolvedValue('A\nB\n')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await enforceEnvRemovalGuard({
      host: 'host',
      sshKey: '/key',
      projectName: 'proj',
      envSrc: '/cwd/secrets.prod.env',
      localKeys: ['A', 'B', 'C'],
      allowEnvRemoval: false,
    })

    const logText = logSpy.mock.calls.map(c => c.join(' ')).join('\n')
    expect(logText).toContain('/cwd/secrets.prod.env')
    expect(logText).toContain('3 keys')
    expect(logText).toContain('2 keys')
    logSpy.mockRestore()
  })

  it('excludes BUILD_NUMBER from the removal decision', async () => {
    vi.mocked(sshExec).mockResolvedValue('A\nBUILD_NUMBER\n')
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })

    await enforceEnvRemovalGuard({
      host: 'host',
      sshKey: '/key',
      projectName: 'proj',
      envSrc: '/cwd/.env',
      localKeys: ['A'],
      allowEnvRemoval: false,
    })

    expect(exitSpy).not.toHaveBeenCalled()
    exitSpy.mockRestore()
  })

  it('aborts non-zero when the server is unreachable', async () => {
    vi.mocked(sshExec).mockRejectedValue(new Error('ssh failed'))
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })

    await expect(
      enforceEnvRemovalGuard({
        host: 'host',
        sshKey: '/key',
        projectName: 'proj',
        envSrc: '/cwd/.env',
        localKeys: ['A'],
        allowEnvRemoval: false,
      }),
    ).rejects.toThrow('process.exit')

    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })
})

describe('deploy command --dry-run', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadConfig).mockReturnValue(baseConfig as ReturnType<typeof loadConfig>)
    vi.mocked(runAnsible).mockResolvedValue(undefined)
  })

  it('makes no runAnsible call', async () => {
    const program = new Command()
    program.exitOverride()
    registerDeploy(program)

    await program.parseAsync(['node', 'cli', 'deploy', '--inventory', '/inv.ini', '--dry-run'])

    expect(runAnsible).not.toHaveBeenCalled()
  })

  it('calls runAnsible exactly once without --dry-run', async () => {
    const program = new Command()
    program.exitOverride()
    registerDeploy(program)

    await program.parseAsync(['node', 'cli', 'deploy', '--inventory', '/inv.ini'])

    expect(runAnsible).toHaveBeenCalledOnce()
    expect(runAnsible).toHaveBeenCalledWith('deploy', '/inv.ini', expect.objectContaining({ project_name: 'test-project' }))
  })
})
