import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Command } from 'commander'
import { join } from 'node:path'
import { registerSetup } from './setup.js'

vi.mock('@emit-infra/core', () => ({
  loadConfig: vi.fn(),
  runTerraform: vi.fn(),
  getTerraformOutput: vi.fn(),
  runAnsible: vi.fn(),
  ensureSshKey: vi.fn(),
  ensureHetznerKey: vi.fn(),
  resolveAccountId: vi.fn(),
  resolveZoneId: vi.fn(),
  ensureR2Bucket: vi.fn(),
  createR2Token: vi.fn(),
  revokeR2Token: vi.fn(),
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue('fake-key-content'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}))

vi.mock('node:os', () => ({
  homedir: vi.fn().mockReturnValue('/home/test'),
}))

vi.mock('execa', () => ({
  execa: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}))

import {
  loadConfig,
  runTerraform,
  getTerraformOutput,
  runAnsible,
  ensureSshKey,
  ensureHetznerKey,
  ensureR2Bucket,
} from '@emit-infra/core'
import { existsSync } from 'node:fs'
import { execa } from 'execa'

const baseConfig = {
  name: 'test-project',
  domain: 'test.com',
  region: 'nbg1' as const,
  serverType: 'cx22',
  sshKeyName: 'emit-deploy',
  github: { repo: 'user/test' },
  deploy: { appDir: '/app', composeDest: 'docker-compose.yml' },
}

const tfDir = join(process.cwd(), 'terraform')

function setupHappyPath() {
  vi.mocked(existsSync).mockImplementation((p) => String(p).endsWith('terraform'))
  vi.mocked(ensureSshKey).mockResolvedValue({
    privateKey: '/home/test/.ssh/emit-deploy',
    publicKey: 'ssh-ed25519 FAKEPUB',
    wasCreated: false,
  } as Awaited<ReturnType<typeof ensureSshKey>>)
  vi.mocked(ensureHetznerKey).mockResolvedValue('found')
  vi.mocked(ensureR2Bucket).mockResolvedValue(undefined)
  vi.mocked(getTerraformOutput).mockResolvedValue('5.6.7.8')
  vi.mocked(runTerraform).mockResolvedValue(undefined)
  vi.mocked(runAnsible).mockResolvedValue(undefined)
}

let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(loadConfig).mockReturnValue(baseConfig as ReturnType<typeof loadConfig>)

  savedEnv = {
    TF_VAR_hcloud_token: process.env.TF_VAR_hcloud_token,
    TF_VAR_cloudflare_api_token: process.env.TF_VAR_cloudflare_api_token,
    TF_VAR_cloudflare_zone_id: process.env.TF_VAR_cloudflare_zone_id,
    TF_VAR_cloudflare_account_id: process.env.TF_VAR_cloudflare_account_id,
    CF_R2_ACCESS_KEY_ID: process.env.CF_R2_ACCESS_KEY_ID,
    CF_R2_SECRET_ACCESS_KEY: process.env.CF_R2_SECRET_ACCESS_KEY,
  }
  process.env.TF_VAR_hcloud_token = 'fake-hcloud'
  process.env.TF_VAR_cloudflare_api_token = 'fake-cf-token'
  process.env.TF_VAR_cloudflare_zone_id = 'fake-zone-id'
  process.env.TF_VAR_cloudflare_account_id = 'fake-account-id'
  process.env.CF_R2_ACCESS_KEY_ID = 'fake-access-key'
  process.env.CF_R2_SECRET_ACCESS_KEY = 'fake-secret-key'
})

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe('setup command', () => {
  it('exits without running any executors when terraform/ dir is missing', async () => {
    vi.mocked(existsSync).mockReturnValue(false)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })

    const program = new Command()
    program.exitOverride()
    registerSetup(program)

    await expect(program.parseAsync(['node', 'cli', 'setup'])).rejects.toThrow('process.exit')
    expect(runTerraform).not.toHaveBeenCalled()
    expect(runAnsible).not.toHaveBeenCalled()
    exitSpy.mockRestore()
  })

  it('exits without running any executors when required env vars are missing', async () => {
    vi.mocked(existsSync).mockImplementation((p) => String(p).endsWith('terraform'))
    delete process.env.TF_VAR_hcloud_token
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit') })

    const program = new Command()
    program.exitOverride()
    registerSetup(program)

    await expect(program.parseAsync(['node', 'cli', 'setup'])).rejects.toThrow('process.exit')
    expect(runTerraform).not.toHaveBeenCalled()
    exitSpy.mockRestore()
  })

  it('calls terraform init with backend-config args', async () => {
    setupHappyPath()

    const program = new Command()
    program.exitOverride()
    registerSetup(program)
    await program.parseAsync(['node', 'cli', 'setup'])

    expect(runTerraform).toHaveBeenCalledWith(
      'init',
      ['-input=false', '-backend-config=access_key=fake-access-key', '-backend-config=secret_key=fake-secret-key'],
      tfDir,
      expect.any(Function),
    )
  })

  it('calls terraform apply with -auto-approve -input=false', async () => {
    setupHappyPath()

    const program = new Command()
    program.exitOverride()
    registerSetup(program)
    await program.parseAsync(['node', 'cli', 'setup'])

    expect(runTerraform).toHaveBeenCalledWith('apply', ['-auto-approve', '-input=false'], tfDir)
  })

  it('--skip-configure: does not call runAnsible', async () => {
    setupHappyPath()

    const program = new Command()
    program.exitOverride()
    registerSetup(program)
    await program.parseAsync(['node', 'cli', 'setup', '--skip-configure'])

    expect(runAnsible).not.toHaveBeenCalled()
  })

  it('calls runAnsible with correct project vars when not skipped', async () => {
    setupHappyPath()

    const program = new Command()
    program.exitOverride()
    registerSetup(program)
    await program.parseAsync(['node', 'cli', 'setup'])

    const inventoryPath = join(process.cwd(), 'ansible-inventory.ini')
    expect(runAnsible).toHaveBeenCalledWith(
      'provision',
      inventoryPath,
      expect.objectContaining({
        project_name: 'test-project',
        domain: 'test.com',
        app_dir: '/app',
      }),
    )
  })

  it('passes blue_green and the blue-slot ports for a blue-green project', async () => {
    setupHappyPath()
    vi.mocked(loadConfig).mockReturnValue({
      ...baseConfig,
      blueGreen: {
        services: [
          { name: 'web', bluePort: 4300, greenPort: 4400 },
          { name: 'api', bluePort: 4301, greenPort: 4401 },
        ],
        composeStructure: 'separate',
      },
    } as ReturnType<typeof loadConfig>)

    const program = new Command()
    program.exitOverride()
    registerSetup(program)
    await program.parseAsync(['node', 'cli', 'setup'])

    const inventoryPath = join(process.cwd(), 'ansible-inventory.ini')
    expect(runAnsible).toHaveBeenCalledWith(
      'provision',
      inventoryPath,
      expect.objectContaining({
        blue_green: true,
        blue_web_port: 4300,
        blue_api_port: 4301,
      }),
    )
  })

  it('does not pass blue_green or slot ports for a non-blue-green project', async () => {
    setupHappyPath()

    const program = new Command()
    program.exitOverride()
    registerSetup(program)
    await program.parseAsync(['node', 'cli', 'setup'])

    const callVars = vi.mocked(runAnsible).mock.calls[0]?.[2] as Record<string, unknown>
    expect(callVars).not.toHaveProperty('blue_green')
    expect(callVars).not.toHaveProperty('blue_web_port')
  })

  it('pushes SERVER_IP and SSH_PRIVATE_KEY to github', async () => {
    setupHappyPath()

    const program = new Command()
    program.exitOverride()
    registerSetup(program)
    await program.parseAsync(['node', 'cli', 'setup', '--skip-configure'])

    expect(execa).toHaveBeenCalledWith('gh', ['secret', 'set', 'SERVER_IP', '--repo', 'user/test'], { input: '5.6.7.8' })
    expect(execa).toHaveBeenCalledWith('gh', ['secret', 'set', 'SSH_PRIVATE_KEY', '--repo', 'user/test'], { input: 'fake-key-content' })
  })
})
