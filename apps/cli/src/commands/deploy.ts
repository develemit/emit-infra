import { Command } from 'commander'
import { join, dirname } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import chalk from 'chalk'
import { loadConfig, runAnsible, sshExec, deployRecordInit, deployRecordDone, type ProjectConfig } from '@emit-infra/core'
import { resolveInventoryPath } from './configure.js'
import { parseKeyList, filterExcludedKeys } from './secrets-scaffold.js'
import { parseEnvEntries } from '../lib/env-file.js'

const BACKUP_ENV_KEYS = ['CF_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] as const

export function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  return Object.fromEntries(parseEnvEntries(readFileSync(path, 'utf8')))
}

// Local-only: never touches the network, safe to call from --dry-run. A file
// that exists but can't be read (permissions, race with printDryRunPlan's own
// existsSync check) must not crash the dry run, so the count is best-effort.
function localEnvKeyCount(path: string): number | null {
  try {
    return Object.keys(parseEnvFile(path)).length
  } catch {
    return null
  }
}

export function printDryRunPlan(
  config: ProjectConfig,
  inventory: string,
  extraVars: Record<string, unknown>,
): void {
  console.log(chalk.yellow('\n╔════════════════════════════════════════╗'))
  console.log(chalk.yellow('║      DRY RUN — no changes made         ║'))
  console.log(chalk.yellow('╚════════════════════════════════════════╝\n'))

  console.log(chalk.bold('Project:  '), config.name)
  const strategy = config.blueGreen ? 'blue-green' : 'standard'
  console.log(chalk.bold('Strategy: '), strategy)
  console.log(chalk.bold('Inventory:'), inventory)

  if (config.blueGreen) {
    console.log(chalk.bold('\nBlue-Green config:'))
    console.log(`  Compose structure: ${config.blueGreen.composeStructure}`)
    console.log('  Services:')
    for (const s of config.blueGreen.services) {
      console.log(`    ${s.name.padEnd(12)} blue: ${s.bluePort}  green: ${s.greenPort}  health: ${s.healthPath ?? 'skip'}`)
    }
    if (config.blueGreen.migratePre) console.log(`  Migrate pre:  ${config.blueGreen.migratePre}`)
    if (config.blueGreen.migratePost) console.log(`  Migrate post: ${config.blueGreen.migratePost}`)
  }

  console.log(chalk.bold('\nDeploy artifacts:'))
  if (extraVars.compose_src) {
    const exists = existsSync(extraVars.compose_src as string)
    console.log(`  Compose src: ${extraVars.compose_src} ${exists ? chalk.green('✓') : chalk.red('✗ missing')}`)
  }
  if (extraVars.blue_green_compose_files) {
    for (const f of extraVars.blue_green_compose_files as string[]) {
      const exists = existsSync(f)
      console.log(`  Compose file: ${f} ${exists ? chalk.green('✓') : chalk.red('✗ missing')}`)
    }
  }
  if (extraVars.env_src) {
    const envPath = extraVars.env_src as string
    const exists = existsSync(envPath)
    if (exists) {
      const count = localEnvKeyCount(envPath)
      const suffix = count === null ? '' : ` (${count} keys)`
      console.log(`  Env file:    ${envPath} ${chalk.green('✓' + suffix)}`)
    } else {
      console.log(`  Env file:    ${envPath} ${chalk.red('✗ missing')}`)
    }
  }
  if (extraVars.extra_files) {
    for (const ef of extraVars.extra_files as Array<{ src: string; dest: string; dir?: boolean }>) {
      const exists = existsSync(ef.src)
      const label = ef.dir ? 'Extra dir:  ' : 'Extra file: '
      console.log(`  ${label} ${ef.src} → ${ef.dest} ${exists ? chalk.green('✓') : chalk.red('✗ missing')}`)
    }
  }
  if (extraVars.nginx_custom_config_src) {
    const exists = existsSync(extraVars.nginx_custom_config_src as string)
    console.log(`  Nginx vhost: ${extraVars.nginx_custom_config_src} ${exists ? chalk.green('✓') : chalk.red('✗ missing')}`)
  }

  console.log(chalk.bold('\nAnsible extra-vars:'))
  console.log(JSON.stringify(extraVars, null, 2))

  if (config.blueGreen) {
    console.log(chalk.dim('\nℹ Active/inactive slot is detected at deploy time by Ansible.'))
  }

  console.log(chalk.yellow('\nDRY RUN complete — no changes were made.\n'))
}

export function checkBackupEnv(config: ProjectConfig, cwd: string = process.cwd()): void {
  if (!config.postgres?.backupBucket) return

  // Same candidate precedence as the deploy path (see buildDeployExtraVars), so
  // a project whose real server env lives at ci.envFile isn't checked against a
  // different file than the one actually deployed.
  const envCandidates = [config.ci?.envFile, '.env.prod', '.env']
    .filter(Boolean)
    .map(f => join(cwd, f!))
  const envPath = envCandidates.find(p => existsSync(p)) ?? join(cwd, '.env')
  const env = parseEnvFile(envPath)
  const missing = BACKUP_ENV_KEYS.filter(k => !env[k])

  if (missing.length === 0) return

  console.error(chalk.red('\nPostgres backup is configured but required R2 credentials are missing from .env:\n'))
  missing.forEach(k => console.error(chalk.red(`  missing: ${chalk.bold(k)}`)))
  console.error(chalk.yellow(`\nAdd these to ${envPath} before deploying:`))
  console.error(chalk.dim('  CF_ACCOUNT_ID         — your Cloudflare account ID'))
  console.error(chalk.dim('  R2_ACCESS_KEY_ID      — R2 API token access key ID'))
  console.error(chalk.dim('  R2_SECRET_ACCESS_KEY  — R2 API token secret access key'))
  process.exit(1)
}

export function buildDeployExtraVars(
  config: ProjectConfig,
  cwd: string,
  env: NodeJS.ProcessEnv,
  existsFn: (p: string) => boolean = existsSync,
): Record<string, unknown> {
  const extraVars: Record<string, unknown> = { project_name: config.name }

  if (config.deploy) {
    extraVars.compose_src = join(cwd, config.deploy.composeSrc)
    extraVars.compose_dest = config.deploy.composeDest
    if (config.deploy.extraFiles.length > 0) {
      extraVars.extra_files = config.deploy.extraFiles.map((f) => ({
        src: join(cwd, f.src),
        dest: f.dest,
        dir: f.dir,
      }))
    }
    if (config.deploy.postDeployExec && config.deploy.postDeployExec.length > 0) {
      extraVars.post_deploy_exec = config.deploy.postDeployExec
    }
    if (config.deploy.appPort) {
      extraVars.app_port = config.deploy.appPort
    }
  }

  if (config.healthCheck?.url) {
    extraVars.health_check_url = config.healthCheck.url
  }

  if (config.nginx?.syncOnDeploy && config.nginx.customConfigSrc) {
    extraVars.nginx_custom_config_src = join(cwd, config.nginx.customConfigSrc)
  }

  if (config.postgres) {
    extraVars.postgres_version = config.postgres.version ?? '16'
    if (config.postgres.backupBucket) {
      extraVars.postgres_backup_bucket = config.postgres.backupBucket
    }
  }

  const envCandidates = [config.ci?.envFile, '.env.prod', '.env']
    .filter(Boolean)
    .map(f => join(cwd, f!))
  const envPath = envCandidates.find(p => existsFn(p))
  if (envPath) {
    extraVars.copy_env = true
    extraVars.env_src = envPath
  }

  const ghcrToken = env.GHCR_TOKEN ?? env.CR_PAT
  const ghcrActor = env.GHCR_ACTOR ?? env.GITHUB_ACTOR
  if (ghcrToken) {
    extraVars.ghcr_token = ghcrToken
    extraVars.ghcr_actor = ghcrActor ?? 'x-access-token'
  }

  const buildNumber = env.BUILD_NUMBER
  if (buildNumber) {
    extraVars.build_number = buildNumber
  }

  if (config.blueGreen) {
    extraVars.blue_green = true
    extraVars.bg_services = config.blueGreen.services.map((s) => s.name).join(' ')
    extraVars.bg_ports_blue = config.blueGreen.services.map((s) => s.bluePort).join(' ')
    extraVars.bg_ports_green = config.blueGreen.services.map((s) => s.greenPort).join(' ')
    extraVars.bg_health_checks = config.blueGreen.services
      .map((s) => s.healthPath ?? 'skip')
      .join(' ')
    extraVars.bg_compose_structure = config.blueGreen.composeStructure

    if (config.blueGreen.composeStructure === 'separate') {
      const composeDir = dirname(join(cwd, config.deploy?.composeSrc ?? 'docker-compose.prod.yml'))
      extraVars.blue_green_compose_files = [
        join(composeDir, 'docker-compose.app.yml'),
        join(composeDir, 'docker-compose.blue.yml'),
        join(composeDir, 'docker-compose.green.yml'),
      ].filter(f => existsFn(f))
    }

    if (config.blueGreen.nginxConfPath) {
      extraVars.bg_nginx_conf_path = config.blueGreen.nginxConfPath
    }
    if (config.blueGreen.migratePre) {
      extraVars.bg_migrate_pre = config.blueGreen.migratePre
    }
    if (config.blueGreen.migratePost) {
      extraVars.bg_migrate_post = config.blueGreen.migratePost
    }

    // Pass postDeployExec as structured data for the blue-green script
    // (generic post_deploy_exec can't target the correct slot compose)
    const postExec = config.deploy?.postDeployExec ?? []
    if (postExec.length > 0) {
      extraVars.bg_post_exec = postExec.map(e => `${e.service}:${e.command}`).join('|')
    }
    // Clear generic post_deploy_exec so Ansible doesn't also try it
    delete extraVars.post_deploy_exec
  }

  return extraVars
}

export function computeEnvRemoval(localKeys: string[], serverKeys: string[]): string[] {
  const localSet = new Set(localKeys)
  return filterExcludedKeys(serverKeys.filter(k => !localSet.has(k))).sort()
}

async function readServerEnvKeys(host: string, projectName: string, sshKey: string): Promise<string[]> {
  const raw = await sshExec(
    host,
    `grep -v '^#' /opt/${projectName}/.env 2>/dev/null | grep '=' | cut -d= -f1 | tr -d ' '`,
    sshKey,
  )
  return parseKeyList(raw)
}

export async function enforceEnvRemovalGuard(opts: {
  host: string
  sshKey: string
  projectName: string
  envSrc: string
  localKeys: string[]
  allowEnvRemoval: boolean
}): Promise<void> {
  let serverKeys: string[]
  try {
    serverKeys = await readServerEnvKeys(opts.host, opts.projectName, opts.sshKey)
  } catch {
    console.error(chalk.red(`Could not read /opt/${opts.projectName}/.env on ${opts.host} to check for key removal — is the host reachable?`))
    process.exit(1)
    return
  }

  console.log(chalk.bold('Env file:    ') + `${opts.envSrc} (${opts.localKeys.length} keys) → server (${serverKeys.length} keys)`)

  const removed = computeEnvRemoval(opts.localKeys, serverKeys)
  if (removed.length === 0) return

  if (!opts.allowEnvRemoval) {
    console.error(chalk.red(`\nThis deploy would remove ${removed.length} key(s) present on the server .env but absent from ${opts.envSrc}:\n`))
    removed.forEach(k => console.error(chalk.red(`  - ${k}`)))
    console.error(chalk.yellow('\nRe-run with --allow-env-removal if this is intentional.'))
    process.exit(1)
    return
  }

  console.warn(chalk.yellow(`\n⚠ --allow-env-removal set — removing ${removed.length} key(s) from the server .env:\n`))
  removed.forEach(k => console.warn(chalk.yellow(`  - ${k}`)))
}

export function registerDeploy(program: Command): void {
  program
    .command('deploy [name]')
    .description('Pull latest images and restart the app (Ansible deploy playbook)')
    .option('--config <path>', 'Path to .emit-infra.json')
    .option('--inventory <path>', 'Path to Ansible inventory file')
    .option('-n, --dry-run', 'Validate config and show deploy plan without making SSH connections')
    .option('--allow-env-removal', 'Allow a deploy to remove server .env keys absent from the local env file')
    .action(async (_name: string | undefined, opts: { config?: string; inventory?: string; dryRun?: boolean; allowEnvRemoval?: boolean }) => {
      const config = loadConfig(opts.config)

      if (!opts.dryRun) {
        checkBackupEnv(config, process.cwd())
      }

      if (opts.dryRun) {
        console.log(chalk.cyan(`Validating deploy plan for ${chalk.bold(config.name)}...`))
      } else {
        console.log(chalk.cyan(`Deploying ${chalk.bold(config.name)}...`))
      }

      const inventory = opts.inventory ?? (await resolveInventoryPath(config.name, config))
      const extraVars = buildDeployExtraVars(config, process.cwd(), process.env)

      if (!extraVars.ghcr_token) {
        console.warn(chalk.yellow('Warning: GHCR_TOKEN not set — docker pull may fail for private images'))
      }

      if (opts.dryRun) {
        printDryRunPlan(config, inventory, extraVars)
        return
      }

      if (extraVars.copy_env) {
        await enforceEnvRemovalGuard({
          host: config.serverIp ?? config.domain,
          sshKey: join(homedir(), '.ssh', config.sshKeyName),
          projectName: config.name,
          envSrc: extraVars.env_src as string,
          localKeys: Object.keys(parseEnvFile(extraVars.env_src as string)),
          allowEnvRemoval: Boolean(opts.allowEnvRemoval),
        })
      }

      const deployCtx = await deployRecordInit(process.cwd())
      const phaseStartedAt = Date.now()
      try {
        await runAnsible('deploy', inventory, extraVars)
      } catch (err) {
        await deployRecordDone(process.cwd(), deployCtx, 'failed', {
          deploy: Math.round((Date.now() - phaseStartedAt) / 1000),
        })
        throw err
      }
      await deployRecordDone(process.cwd(), deployCtx, 'deployed', {
        deploy: Math.round((Date.now() - phaseStartedAt) / 1000),
      })

      console.log(chalk.green(`\nDeployed successfully.`))
    })
}
