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
    .action(async (_name: string | undefined, opts: { config?: string }) => {
      const config = loadConfig(opts.config)
      const host = config.serverIp ?? config.domain
      const key = join(homedir(), '.ssh', config.sshKeyName)
      const appDir = config.deploy?.appDir ?? '/app'
      const composeFile = config.deploy?.composeDest ?? 'docker-compose.yml'

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

      await sshExec(
        host,
        `cd ${appDir} && docker compose -f ${composeFile} up -d --remove-orphans`,
        key,
      )
      console.log(chalk.dim('Restarted app stack'))

      try {
        const result = await sshExec(host, `${appDir}/health-check.sh 3000 10`, key)
        console.log(chalk.dim(result))
        console.log(chalk.green('\nRollback successful. Previous version is now serving traffic.'))
      } catch {
        console.error(chalk.yellow('\nRollback applied but health check failed. Check the server manually.'))
        process.exit(1)
      }
    })
}
