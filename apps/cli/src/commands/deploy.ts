import { Command } from 'commander'
import { join, dirname } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import chalk from 'chalk'
import { loadConfig, runAnsible, type ProjectConfig } from '@emit-infra/core'
import { resolveInventoryPath } from './configure.js'

const BACKUP_ENV_KEYS = ['CF_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] as const

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter(line => /^\s*[A-Z_]+=/.test(line))
      .map(line => {
        const idx = line.indexOf('=')
        return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()] as [string, string]
      }),
  )
}

function printDryRunPlan(
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
    const exists = existsSync(extraVars.env_src as string)
    console.log(`  Env file:    ${extraVars.env_src} ${exists ? chalk.green('✓') : chalk.red('✗ missing')}`)
  }
  if (extraVars.extra_files) {
    for (const ef of extraVars.extra_files as Array<{ src: string; dest: string }>) {
      const exists = existsSync(ef.src)
      console.log(`  Extra file:  ${ef.src} → ${ef.dest} ${exists ? chalk.green('✓') : chalk.red('✗ missing')}`)
    }
  }

  console.log(chalk.bold('\nAnsible extra-vars:'))
  console.log(JSON.stringify(extraVars, null, 2))

  if (config.blueGreen) {
    console.log(chalk.dim('\nℹ Active/inactive slot is detected at deploy time by Ansible.'))
  }

  console.log(chalk.yellow('\nDRY RUN complete — no changes were made.\n'))
}

function checkBackupEnv(config: ProjectConfig): void {
  if (!config.postgres?.backupBucket) return

  const envCandidates = ['.env.prod', '.env'].map(f => join(process.cwd(), f))
  const envPath = envCandidates.find(p => existsSync(p)) ?? join(process.cwd(), '.env')
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

export function registerDeploy(program: Command): void {
  program
    .command('deploy [name]')
    .description('Pull latest images and restart the app (Ansible deploy playbook)')
    .option('--config <path>', 'Path to .emit-infra.json')
    .option('--inventory <path>', 'Path to Ansible inventory file')
    .option('-n, --dry-run', 'Validate config and show deploy plan without making SSH connections')
    .action(async (_name: string | undefined, opts: { config?: string; inventory?: string; dryRun?: boolean }) => {
      const config = loadConfig(opts.config)

      if (!opts.dryRun) {
        checkBackupEnv(config)
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

      await runAnsible('deploy', inventory, extraVars)

      console.log(chalk.green(`\nDeployed successfully.`))
    })
}
