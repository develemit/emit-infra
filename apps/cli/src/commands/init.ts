import { Command } from 'commander'
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import chalk from 'chalk'
import type { ProjectConfig } from '@emit-infra/core'

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

      console.log(chalk.cyan(`\nNext steps:`))
      console.log(`  emit-infra provision ${name}`)
      console.log(`  emit-infra configure ${name}`)
      console.log(`  emit-infra deploy ${name}`)
    })
}

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
