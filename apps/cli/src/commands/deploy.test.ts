import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { Command } from 'commander'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildDeployExtraVars, computeEnvRemoval, enforceEnvRemovalGuard, parseEnvFile, registerDeploy } from './deploy.js'

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

describe('parseEnvFile', () => {
  let dir: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deploy-parse-env-'))
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  function write(name: string, content: string): string {
    const p = join(dir, name)
    writeFileSync(p, content)
    return p
  }

  it('parses keys containing digits', () => {
    // Regression: an earlier /^\s*[A-Z_]+=/ filter dropped every one of these,
    // which made the env-removal guard report them as phantom removals.
    const p = write('digits.env', [
      'R2_BUCKET=my-bucket',
      'R2_ACCESS_KEY_ID=abc123',
      'R2_SECRET_ACCESS_KEY=shh',
      'S3_REGION=auto',
      'DATABASE_URL=postgres://x',
    ].join('\n'))

    const env = parseEnvFile(p)

    expect(Object.keys(env).sort()).toEqual([
      'DATABASE_URL', 'R2_ACCESS_KEY_ID', 'R2_BUCKET', 'R2_SECRET_ACCESS_KEY', 'S3_REGION',
    ])
    expect(env['R2_BUCKET']).toBe('my-bucket')
    expect(env['S3_REGION']).toBe('auto')
  })

  it('still skips comments, blanks and garbage lines', () => {
    const p = write('mixed.env', [
      '# FOO=bar',
      '   # R2_COMMENTED=nope',
      '',
      '   ',
      'not an env line',
      '=leading-equals',
      '9STARTS_WITH_DIGIT=nope',
      'REAL_KEY=yes',
      'R2_ALSO_REAL=yes',
    ].join('\n'))

    expect(Object.keys(parseEnvFile(p)).sort()).toEqual(['R2_ALSO_REAL', 'REAL_KEY'])
  })

  it('tolerates leading whitespace before the key', () => {
    const p = write('indented.env', '  R2_BUCKET=b\n\tDATABASE_URL=d\n')
    expect(Object.keys(parseEnvFile(p)).sort()).toEqual(['DATABASE_URL', 'R2_BUCKET'])
  })

  it('returns an empty object for a missing file', () => {
    expect(parseEnvFile(join(dir, 'does-not-exist.env'))).toEqual({})
  })

  it('agrees with the SSH-side key extraction on the same content', () => {
    // The server side reads keys with `grep '=' | cut -d= -f1`; the local parser
    // must not be stricter, or the guard manufactures removals.
    const content = ['R2_ENDPOINT=x', 'R2_BUCKET=y', 'CF_ACCOUNT_ID=z', 'PLAIN=1'].join('\n')
    const p = write('agree.env', content)
    const shellEquivalent = content
      .split('\n')
      .filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
      .map(l => l.slice(0, l.indexOf('=')).trim())

    expect(Object.keys(parseEnvFile(p)).sort()).toEqual(shellEquivalent.sort())
  })
})

describe('computeEnvRemoval — pinned emit-vision false positive', () => {
  it('reports no removals when digit-containing keys are present on both sides', () => {
    // This is the exact case that blocked an emit-vision deploy on 2026-07-24:
    // the four R2_* keys existed in the local file but the parser dropped them,
    // so the guard believed the deploy would delete them from the server.
    const localKeys = [
      'DATABASE_URL', 'REDIS_URL', 'SESSION_SECRET',
      'R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
    ]
    const serverKeys = [...localKeys, 'BUILD_NUMBER']

    expect(computeEnvRemoval(localKeys, serverKeys)).toEqual([])
  })

  it('would have reported four removals with the old digit-blind key list', () => {
    // Demonstrates the bug's mechanism: drop the digit keys from the local side
    // (what the old regex effectively did) and the same server state yields the
    // four phantom removals from the original error message.
    const digitBlindLocalKeys = ['DATABASE_URL', 'REDIS_URL', 'SESSION_SECRET']
    const serverKeys = [
      'DATABASE_URL', 'REDIS_URL', 'SESSION_SECRET',
      'R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'BUILD_NUMBER',
    ]

    expect(computeEnvRemoval(digitBlindLocalKeys, serverKeys).sort()).toEqual(
      ['R2_ACCESS_KEY_ID', 'R2_BUCKET', 'R2_ENDPOINT', 'R2_SECRET_ACCESS_KEY'],
    )
  })
})
