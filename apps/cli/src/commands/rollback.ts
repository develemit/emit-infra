import { Command } from 'commander'
import { homedir } from 'node:os'
import { join } from 'node:path'
import chalk from 'chalk'
import { loadConfig, sshExec } from '@emit-infra/core'

export function registerRollback(program: Command): void {
  program
    .command('rollback [name]')
    .description('Restore :rollback-tagged images and restart the app stack')
    .option('--config <path>', 'Path to .emit-infra.json')
    .option('--version <N>', 'Roll back to a specific build number from the registry')
    .option('--timestamp <tag>', 'Roll back to a specific timestamped snapshot (e.g. rollback-20260611T221443)')
    .option('--list', 'List available timestamped rollback snapshots')
    .option('--port <port>', 'Override health-check port')
    .action(async (_name: string | undefined, opts: { config?: string; version?: string; timestamp?: string; list?: boolean; port?: string }) => {
      const config = loadConfig(opts.config)
      const host = config.serverIp ?? config.domain
      const key = join(homedir(), '.ssh', config.sshKeyName)
      const appDir = config.deploy?.appDir ?? '/app'
      const composeFile = config.deploy?.composeDest ?? 'docker-compose.yml'
      const port = opts.port ?? config.deploy?.appPort ?? '3000'

      console.log(chalk.cyan(`Rolling back ${chalk.bold(config.name)} on ${host}...\n`))

      const images = await sshExec(
        host,
        `cd ${appDir} && docker compose -f ${composeFile} config --images`,
        key,
      )
      const imageList = images.split('\n').map(l => l.trim()).filter(Boolean)

      if (imageList.length === 0) {
        console.error(chalk.red('No images found in compose config.'))
        process.exit(1)
      }

      if (opts.list) {
        await listRollbackSnapshots(host, key, imageList)
      } else if (opts.version) {
        await rollbackToVersion(host, key, appDir, composeFile, imageList, opts.version, port)
      } else if (opts.timestamp) {
        await rollbackToTimestamp(host, key, appDir, composeFile, imageList, opts.timestamp, port)
      } else {
        await rollbackToTag(host, key, appDir, composeFile, imageList, port)
      }
    })
}

async function rollbackToVersion(
  host: string, key: string, appDir: string, composeFile: string,
  imageList: string[], version: string, port: string,
): Promise<void> {
  console.log(chalk.dim(`Pulling build ${version} from registry...`))

  const pullAndTag = imageList
    .map(img => {
      const base = img.split(':')[0]
      return `docker pull "${base}:${version}" && docker tag "${base}:${version}" "${base}:latest"`
    })
    .join(' && ')

  try {
    await sshExec(host, pullAndTag, key)
  } catch {
    console.error(chalk.red(`Failed to pull build ${version}. Run "emit versions" to see available builds.`))
    process.exit(1)
  }

  console.log(chalk.dim(`Tagged build ${version} as :latest`))
  await restartAndHealthCheck(host, key, appDir, composeFile, port)
}

async function rollbackToTag(
  host: string, key: string, appDir: string, composeFile: string,
  imageList: string[], port: string,
): Promise<void> {
  const checkScript = imageList
    .map(img => `docker image inspect "${img.split(':')[0]}:rollback" > /dev/null 2>&1`)
    .join(' && ')

  try {
    await sshExec(host, checkScript, key)
  } catch {
    console.error(chalk.red('No :rollback tags found on the server. Has a deploy run since the last rollback?'))
    process.exit(1)
  }

  const tagScript = imageList
    .map(img => {
      const base = img.split(':')[0]
      return `docker tag "${base}:rollback" "${base}:latest"`
    })
    .join(' && ')

  await sshExec(host, tagScript, key)
  console.log(chalk.dim('Restored :rollback tags to :latest'))
  await restartAndHealthCheck(host, key, appDir, composeFile, port)
}

async function listRollbackSnapshots(host: string, key: string, imageList: string[]): Promise<void> {
  const firstImage = imageList[0]!.split(':')[0]
  const output = await sshExec(
    host,
    `docker images --format "{{.Repository}}:{{.Tag}}" "${firstImage}" | grep ":rollback-" | sort -r`,
    key,
  )
  const lines = output.trim()
  console.log(lines || '(no rollback snapshots found)')
}

async function rollbackToTimestamp(
  host: string, key: string, appDir: string, composeFile: string,
  imageList: string[], timestamp: string, port: string,
): Promise<void> {
  console.log(chalk.dim(`Tagging ${timestamp} as :latest...`))

  const tagScript = imageList
    .map(img => {
      const base = img.split(':')[0]
      return `docker tag "${base}:${timestamp}" "${base}:latest"`
    })
    .join(' && ')

  try {
    await sshExec(host, tagScript, key)
  } catch {
    console.error(chalk.red(`Failed to tag ${timestamp}. Run "emit-infra rollback --list" to see available snapshots.`))
    process.exit(1)
  }

  console.log(chalk.dim(`Tagged ${timestamp} as :latest`))
  await restartAndHealthCheck(host, key, appDir, composeFile, port)
}

async function restartAndHealthCheck(
  host: string, key: string, appDir: string, composeFile: string, port: string,
): Promise<void> {
  await sshExec(
    host,
    `cd ${appDir} && docker compose -f ${composeFile} up -d --remove-orphans`,
    key,
  )
  console.log(chalk.dim('Restarted app stack'))

  try {
    const result = await sshExec(host, `${appDir}/health-check.sh ${port} 10`, key)
    console.log(chalk.dim(result))
    console.log(chalk.green('\nRollback successful. Previous version is now serving traffic.'))
  } catch {
    console.error(chalk.yellow('\nRollback applied but health check failed. Check the server manually.'))
    process.exit(1)
  }
}
