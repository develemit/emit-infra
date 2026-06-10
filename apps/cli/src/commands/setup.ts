import { Command } from 'commander'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import chalk from 'chalk'
import { execa } from 'execa'
import {
  loadConfig,
  runTerraform,
  getTerraformOutput,
  runAnsible,
  ensureSshKey,
  ensureHetznerKey,
  resolveAccountId,
  ensureR2Bucket,
  createR2Token,
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
      const hasBuckets = (config.r2?.buckets?.length ?? 0) > 0
      const hasBackupBucket = !!config.postgres?.backupBucket
      const total = hasBuckets || hasBackupBucket ? 7 : 6

      if (!existsSync(tfDir)) {
        console.error(chalk.red(`No terraform/ directory found. Run "emit-infra init ${config.name}" first.`))
        process.exit(1)
      }

      // ── Pre-flight: required env vars ────────────────────────────────────────
      const requiredTfVars = ['TF_VAR_hcloud_token', 'TF_VAR_cloudflare_api_token', 'TF_VAR_cloudflare_zone_id']
      const missingVars = requiredTfVars.filter((v) => !process.env[v])
      if (missingVars.length > 0) {
        console.error(chalk.red('\nMissing required env vars for Terraform:'))
        missingVars.forEach((v) => console.error(chalk.red(`  ${v}`)))
        console.error(chalk.yellow('\nExport them before running setup, e.g.:'))
        console.error(chalk.gray('  export TF_VAR_hcloud_token="<hetzner token>"'))
        console.error(chalk.gray('  export TF_VAR_cloudflare_api_token="<cf token>"'))
        console.error(chalk.gray('  export TF_VAR_cloudflare_zone_id="<zone id>"'))
        process.exit(1)
      }

      if (config.stripe && !process.env.STRIPE_SECRET_KEY) {
        console.error(chalk.red('\nThis project has Stripe enabled but STRIPE_SECRET_KEY is not set.'))
        console.error(chalk.gray('  export STRIPE_SECRET_KEY="sk_live_..."'))
        process.exit(1)
      }

      console.log(chalk.bold(`\nSetting up ${chalk.cyan(config.name)}\n`))

      // ── Step 1: SSH key ──────────────────────────────────────────────────────
      step(1, total, 'Checking SSH key')
      const key = await ensureSshKey(config.sshKeyName)
      if (key.wasCreated) {
        ok(`Generated new key at ${key.privateKey}`)
      } else {
        ok(`Using existing key: ${key.privateKey}`)
      }

      // ── Step 2: Hetzner registration ─────────────────────────────────────────
      step(2, total, `Registering key in Hetzner as "${config.sshKeyName}"`)
      const hetznerResult = await ensureHetznerKey(config.sshKeyName, key.publicKey)
      if (hetznerResult === 'found') ok(`Already registered`)
      else if (hetznerResult === 'created') ok(`Registered successfully`)
      else warn(`Fingerprint already exists under a different name — continuing`)

      // ── Step 3: Remote state bucket ──────────────────────────────────────────
      step(3, total, 'Preparing remote state bucket')
      const cfToken = process.env.TF_VAR_cloudflare_api_token!
      const stateAccountId = await resolveAccountId(cfToken)
      const stateBucket = `${config.name}-tfstate`
      await ensureR2Bucket(stateAccountId, stateBucket, cfToken)
      const stateToken = await createR2Token(stateAccountId, stateBucket, cfToken)
      ok(`State bucket ready: ${stateBucket}`)

      const credDir = join(homedir(), '.emit-infra', config.name)
      mkdirSync(credDir, { recursive: true })
      const credPath = join(credDir, 'terraform-backend.env')
      const credContent = [
        `bucket=${stateBucket}`,
        `access_key=${stateToken.accessKeyId}`,
        `secret_key=${stateToken.secretAccessKey}`,
        `endpoint=https://${stateAccountId}.r2.cloudflarestorage.com`,
      ].join('\n') + '\n'
      writeFileSync(credPath, credContent, { mode: 0o600 })
      ok(`Saved backend credentials to ${credPath}`)

      const backendTf = `terraform {
  backend "s3" {
    bucket                      = "${stateBucket}"
    key                         = "terraform.tfstate"
    region                      = "auto"
    endpoint                    = "https://${stateAccountId}.r2.cloudflarestorage.com"
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    force_path_style            = true
  }
}
`
      writeFileSync(join(tfDir, 'backend.tf'), backendTf)
      ok('Wrote terraform/backend.tf')

      // ── Step 4: Terraform ─────────────────────────────────────────────────────
      step(4, total, 'Provisioning infrastructure')
      await runTerraform('init', [
        '-input=false',
        `-backend-config=access_key=${stateToken.accessKeyId}`,
        `-backend-config=secret_key=${stateToken.secretAccessKey}`,
      ], tfDir)
      await runTerraform('apply', ['-auto-approve', '-input=false'], tfDir)
      ok('Infrastructure provisioned')

      // ── Step 5 (conditional): R2 buckets + tokens ─────────────────────────────
      const r2Secrets: Record<string, string> = {}
      if (hasBuckets || hasBackupBucket) {
        step(5, total, 'Provisioning R2 buckets and tokens')
        const accountId = stateAccountId

        if (hasBackupBucket) {
          const bucket = config.postgres!.backupBucket!
          await ensureR2Bucket(accountId, bucket, cfToken)
          const creds = await createR2Token(accountId, bucket, cfToken)
          r2Secrets['CF_ACCOUNT_ID'] = accountId
          r2Secrets['R2_ACCESS_KEY_ID'] = creds.accessKeyId
          r2Secrets['R2_SECRET_ACCESS_KEY'] = creds.secretAccessKey
        }

        for (const bucket of config.r2?.buckets ?? []) {
          await ensureR2Bucket(accountId, bucket, cfToken)
          const creds = await createR2Token(accountId, bucket, cfToken)
          const prefix = bucket.toUpperCase().replace(/-/g, '_')
          r2Secrets[`R2_${prefix}_ACCESS_KEY_ID`] = creds.accessKeyId
          r2Secrets[`R2_${prefix}_SECRET_ACCESS_KEY`] = creds.secretAccessKey
        }

        ok(`Provisioned ${Object.keys(r2Secrets).length} R2 credentials`)
      }

      const ghStep = hasBuckets || hasBackupBucket ? 6 : 5
      const ansibleStep = hasBuckets || hasBackupBucket ? 7 : 6

      // ── Step 5/6: GitHub secrets ──────────────────────────────────────────────
      step(ghStep, total, `Syncing secrets to ${config.github.repo}`)
      const serverIp = await getTerraformOutput('server_ip', tfDir)
      const privateKeyContent = readFileSync(key.privateKey, 'utf-8')
      await execa('gh', ['secret', 'set', 'SERVER_IP', '--repo', config.github.repo], { input: serverIp })
      await execa('gh', ['secret', 'set', 'SSH_PRIVATE_KEY', '--repo', config.github.repo], { input: privateKeyContent })
      ok(`SERVER_IP (${serverIp}) and SSH_PRIVATE_KEY pushed`)

      if (config.stripe) {
        await execa('gh', ['secret', 'set', 'STRIPE_SECRET_KEY', '--repo', config.github.repo], { input: process.env.STRIPE_SECRET_KEY! })
        ok(`STRIPE_SECRET_KEY pushed (${config.stripe.mode} mode)`)
      }

      for (const [secretKey, secretValue] of Object.entries(r2Secrets)) {
        await execa('gh', ['secret', 'set', secretKey, '--repo', config.github.repo], { input: secretValue })
      }
      if (Object.keys(r2Secrets).length > 0) {
        ok(`R2 secrets pushed: ${Object.keys(r2Secrets).join(', ')}`)
      }

      // ── Step 6/7: Ansible ─────────────────────────────────────────────────────
      if (opts.skipConfigure) {
        console.log(chalk.gray(`\n[${ansibleStep}/${total}] Skipping Ansible configuration (--skip-configure)`))
      } else {
        step(ansibleStep, total, 'Configuring server (this takes a few minutes)')
        const inventoryPath = join(process.cwd(), 'ansible-inventory.ini')
        writeFileSync(inventoryPath, `[${config.name}]\n${serverIp}\n`)

        const ansibleVars: Record<string, unknown> = {
          project_name: config.name,
          domain: config.domain,
          app_dir: config.deploy?.appDir ?? '/app',
          nginx_wildcard_cert: config.nginx?.wildcardCert ?? false,
          cloudflare_api_token: process.env.TF_VAR_cloudflare_api_token ?? '',
        }
        if (config.nginx?.customConfigSrc) {
          ansibleVars.nginx_custom_config_src = join(process.cwd(), config.nginx.customConfigSrc)
        }
        if (config.deploy?.composeDest) {
          ansibleVars.compose_file = config.deploy.composeDest
        }
        if (Object.keys(r2Secrets).length > 0) {
          ansibleVars.r2_credentials = r2Secrets
        }
        if (config.postgres?.backupBucket) {
          ansibleVars.postgres_backup_bucket = config.postgres.backupBucket
        }

        await runAnsible('provision', inventoryPath, ansibleVars)
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
