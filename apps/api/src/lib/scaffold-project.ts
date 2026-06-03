import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdir, writeFile, access } from 'node:fs/promises'

export interface ProvisionConfig {
  name: string
  domain: string
  region?: string
  serverType?: string
  sshKey?: string
}

function mainTf(): string {
  return `terraform {
  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.45"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

provider "hcloud" {}
provider "cloudflare" {}

data "hcloud_ssh_key" "deploy" {
  name = var.ssh_key_name
}

resource "hcloud_server" "main" {
  name        = var.project_name
  image       = "ubuntu-24.04"
  server_type = var.server_type
  location    = var.region
  ssh_keys    = [data.hcloud_ssh_key.deploy.id]
}

resource "cloudflare_record" "main" {
  zone_id = var.cloudflare_zone_id
  name    = var.domain
  content = hcloud_server.main.ipv4_address
  type    = "A"
  ttl     = 300
}

output "server_ip" {
  value = hcloud_server.main.ipv4_address
}
`
}

const VARIABLES_TF = `variable "project_name" {}
variable "domain" {}
variable "region" {}
variable "server_type" {}
variable "ssh_key_name" {}
variable "cloudflare_zone_id" {}
`

function tfvars(cfg: Required<ProvisionConfig>): string {
  return `project_name = "${cfg.name}"
domain       = "${cfg.domain}"
region       = "${cfg.region}"
server_type  = "${cfg.serverType}"
ssh_key_name = "${cfg.sshKey}"
`
}

async function writeIfAbsent(filePath: string, content: string): Promise<void> {
  try {
    await access(filePath)
  } catch {
    await writeFile(filePath, content)
  }
}

export async function scaffoldProject(config: ProvisionConfig): Promise<void> {
  const { name, domain, region = 'nbg1', serverType = 'cx22', sshKey = 'emit-deploy' } = config
  const full = { name, domain, region, serverType, sshKey }

  const projectDir = join(homedir(), 'projects', name)
  const terraformDir = join(projectDir, 'terraform')
  await mkdir(terraformDir, { recursive: true })

  await writeIfAbsent(join(terraformDir, 'main.tf'), mainTf())
  await writeIfAbsent(join(terraformDir, 'variables.tf'), VARIABLES_TF)
  await writeIfAbsent(join(terraformDir, 'terraform.tfvars'), tfvars(full))
}

export async function writeInventory(name: string, ip: string): Promise<void> {
  const content = `[all]
${ip} ansible_user=root ansible_ssh_private_key_file=~/.ssh/emit-deploy

[all:vars]
ansible_ssh_common_args='-o StrictHostKeyChecking=no'
`
  await writeFile(join(homedir(), 'projects', name, 'inventory.ini'), content)
}
