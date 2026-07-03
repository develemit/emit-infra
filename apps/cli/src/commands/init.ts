import { Command } from 'commander'
import { writeFileSync, existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import chalk from 'chalk'
import type { ProjectConfig } from '@emit-infra/core'
import { installHooks } from '../lib/scaffold-hooks.js'

export function registerInit(program: Command): void {
  program
    .command('init <name>')
    .description('Scaffold a project config and Terraform root')
    .option('--domain <domain>', 'Project domain (e.g. myproject.com)')
    .option('--repo <repo>', 'GitHub repo in owner/repo format')
    .option('--region <region>', 'Hetzner region', 'nbg1')
    .option('--server-type <type>', 'Hetzner server type', 'cx22')
    .action((name: string, opts: { domain?: string; repo?: string; region: string; serverType: string }) => {
      const config: Partial<ProjectConfig> = {
        name,
        domain: opts.domain ?? `${name}.com`,
        region: opts.region as ProjectConfig['region'],
        serverType: opts.serverType,
        sshKeyName: 'emit-deploy',
        github: { repo: opts.repo ?? `develemit/${name}` },
      }

      const configPath = join(process.cwd(), '.emit-infra.json')
      if (existsSync(configPath)) {
        console.error(chalk.red(`Config already exists at ${configPath}`))
        process.exit(1)
      }

      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
      console.log(chalk.green(`Created ${configPath}`))

      const tfDir = join(process.cwd(), 'terraform')
      if (!existsSync(tfDir)) {
        mkdirSync(tfDir, { recursive: true })
        writeFileSync(join(tfDir, 'main.tf'), buildTerraformRoot(config as ProjectConfig))
        writeFileSync(join(tfDir, 'variables.tf'), VARIABLES_TF)
        console.log(chalk.green(`Created terraform/ with main.tf and variables.tf`))
      }

      const workflowDir = join(process.cwd(), '.github', 'workflows')
      if (!existsSync(workflowDir)) mkdirSync(workflowDir, { recursive: true })
      const workflowPath = join(workflowDir, 'deploy.yml')
      if (!existsSync(workflowPath)) {
        writeFileSync(workflowPath, buildWorkflow(config as ProjectConfig))
        console.log(chalk.green(`Created .github/workflows/deploy.yml`))
      }

      ensureGitignoreEntry(process.cwd(), '.env.prod')

      const { results, husky } = installHooks(process.cwd())
      for (const r of results) {
        if (r.action === 'linked') console.log(chalk.green(`Linked ${r.path}`))
      }

      console.log(chalk.cyan(`\nNext steps:`))
      console.log(`  emit-infra provision ${name}`)
      console.log(`  emit-infra configure ${name}`)
      console.log(`  emit-infra deploy ${name}`)
      if (!husky) {
        console.log(`  git config core.hooksPath .githooks  # activate hooks`)
      }
      console.log(`  Push to GitHub to trigger the deploy workflow`)
      console.log(`  curl https://${config.domain}/healthz  # verify build number after first deploy`)
    })
}

function ensureGitignoreEntry(cwd: string, entry: string): void {
  const gitignorePath = join(cwd, '.gitignore')
  if (existsSync(gitignorePath)) {
    const current = readFileSync(gitignorePath, 'utf-8')
    if (!current.split('\n').some(l => l.trim() === entry)) {
      appendFileSync(gitignorePath, `\n${entry}\n`)
    }
  } else {
    writeFileSync(gitignorePath, `${entry}\n`)
  }
}

function buildWorkflow(config: ProjectConfig): string {
  const image = `ghcr.io/${config.github.repo}`
  const appDir = config.deploy?.appDir ?? `/opt/${config.name}`

  return `name: Deploy

on:
  push:
    branches: [main]

env:
  IMAGE: ${image}

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: write      # required for git tag push
      packages: write      # required for GHCR push

    steps:
      - uses: actions/checkout@v4

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          push: true
          tags: \${{ env.IMAGE }}:latest,\${{ env.IMAGE }}:\${{ github.sha }}
          # BUILD_NUMBER is passed as a Docker build-arg.
          # Your Dockerfile must declare: ARG BUILD_NUMBER
          # To expose at runtime:        ENV BUILD_NUMBER=$BUILD_NUMBER
          # For Next.js public access:   ENV NEXT_PUBLIC_BUILD_NUMBER=$BUILD_NUMBER
          build-args: |
            BUILD_NUMBER=\${{ github.run_number }}
          labels: |
            build.number=\${{ github.run_number }}

      - name: Deploy to server
        uses: appleboy/ssh-action@v1
        with:
          host: \${{ secrets.SERVER_IP }}
          username: root
          key: \${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd ${appDir}
            docker compose pull
            docker compose up -d --remove-orphans
            docker image prune -f
            echo "\${{ github.run_number }}" > ${appDir}/.deployed-version
`
}

// backend.tf is generated by `emit-infra setup` (remote state via R2) — do not create it here
function buildTerraformRoot(config: ProjectConfig): string {
  return `terraform {
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.48"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

module "server" {
  source      = "github.com/develemit/emit-infra//terraform/modules/hetzner-server?ref=main"
  name        = "${config.name}"
  server_type = "${config.serverType}"
  location    = "${config.region}"
  ssh_key_name = "${config.sshKeyName}"
}

module "dns" {
  source     = "github.com/develemit/emit-infra//terraform/modules/cloudflare-dns?ref=main"
  domain     = "${config.domain}"
  server_ip  = module.server.ipv4_address
}

output "server_ip" {
  value = module.server.ipv4_address
}
`
}

const VARIABLES_TF = `variable "hcloud_token" {
  description = "Hetzner Cloud API token"
  type        = string
  sensitive   = true
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token"
  type        = string
  sensitive   = true
}

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID for the project domain"
  type        = string
}
`
