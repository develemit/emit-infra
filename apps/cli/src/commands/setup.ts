import { Command } from 'commander'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import chalk from 'chalk'
import { execa } from 'execa'
import {
  loadConfig,
  runTerraform,
  getTerraformOutput,
  runAnsible,
  ensureSshKey,
  ensureHetznerKey,
} from '@emit-infra/core'

export function registerSetup(program: Command): void {
  program
    .command('setup [name]')
    .description(
      'Full first-time setup: SSH key → Hetzner registration → provision → GitHub secrets → configure',
    )
    .option('--config <path>', 'Path to .emit-infra.json')
    .option('--skip-configure', 'Provision infrastructure only, skip Ansible configuration')
    .action(async (_name: string | undefined, opts: { config?: string; skipConfigure?: boolean }) => {
      const config = loadConfig(opts.config)
      const tfDir = join(process.cwd(), 'terraform')

      if (!existsSync(tfDir)) {
        console.error(chalk.red(`No terraform/ directory found. Run "emit-infra init ${config.name}" first.`))
        process.exit(1)
      }

      console.log(chalk.bold(`\nSetting up ${chalk.cyan(config.name)}\n`))

      // ── Step 1: SSH key ──────────────────────────────────────────────────────
      step(1, 5, 'Checking SSH key')
      const key = await ensureSshKey(config.sshKeyName)
      if (key.wasCreated) {
        ok(`Generated new key at ${key.privateKey}`)
      } else {
        ok(`Using existing key: ${key.privateKey}`)
      }

      // ── Step 2: Hetzner registration ─────────────────────────────────────────
      step(2, 5, `Registering key in Hetzner as "${config.sshKeyName}"`)
      const hetznerResult = await ensureHetznerKey(config.sshKeyName, key.publicKey)
      if (hetznerResult === 'found') ok(`Already registered`)
      else if (hetznerResult === 'created') ok(`Registered successfully`)
      else warn(`Fingerprint already exists under a different name — continuing`)

      // ── Step 3: Terraform ─────────────────────────────────────────────────────
      step(3, 5, 'Provisioning infrastructure')
      await runTerraform('init', ['-input=false'], tfDir)
      await runTerraform('apply', ['-auto-approve', '-input=false'], tfDir)
      ok('Infrastructure provisioned')

      // ── Step 4: GitHub secrets ────────────────────────────────────────────────
      step(4, 5, `Syncing secrets to ${config.github.repo}`)
      const serverIp = await getTerraformOutput('server_ip', tfDir)
      const privateKeyContent = readFileSync(key.privateKey, 'utf-8')
      await execa('gh', ['secret', 'set', 'SERVER_IP', '--repo', config.github.repo, '--body', serverIp])
      await execa('gh', ['secret', 'set', 'SSH_PRIVATE_KEY', '--repo', config.github.repo, '--body', privateKeyContent])
      ok(`SERVER_IP (${serverIp}) and SSH_PRIVATE_KEY pushed`)

      // ── Step 5: Ansible ───────────────────────────────────────────────────────
      if (opts.skipConfigure) {
        console.log(chalk.gray(`\n[5/5] Skipping Ansible configuration (--skip-configure)`))
      } else {
        step(5, 5, 'Configuring server (this takes a few minutes)')
        const inventoryPath = join(process.cwd(), 'ansible-inventory.ini')
        writeFileSync(inventoryPath, `[${config.name}]\n${serverIp}\n`)
        await runAnsible('provision', inventoryPath, {
          project_name: config.name,
          domain: config.domain,
        })
        ok('Server configured')
      }

      // ── Done ──────────────────────────────────────────────────────────────────
      console.log(chalk.green.bold(`\n✓ ${config.name} is ready\n`))
      console.log(`  Server:  ${serverIp}`)
      console.log(`  Domain:  ${config.domain}`)
      console.log(`  Repo:    ${config.github.repo}`)
      console.log(chalk.cyan(`\n  Next: emit-infra deploy ${config.name}\n`))
    })
}

function step(n: number, total: number, msg: string): void {
  console.log(chalk.bold(`\n[${n}/${total}] ${msg}...`))
}

function ok(msg: string): void {
  console.log(chalk.green(`  ✓ ${msg}`))
}

function warn(msg: string): void {
  console.log(chalk.yellow(`  ⚠ ${msg}`))
}
