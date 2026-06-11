import { Command } from 'commander'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import chalk from 'chalk'
import { createR2Token, revokeR2Token } from '@emit-infra/core'

export function registerR2RotateToken(program: Command): void {
  program
    .command('r2:rotate-token [project]')
    .description('Rotate R2 state bucket token (revoke old + create new + persist)')
    .action(async (projectArg: string | undefined) => {
      const credDir = join(homedir(), '.emit-infra')

      let projectName = projectArg

      if (!projectName) {
        console.error(chalk.red('Error: project name is required'))
        console.error(chalk.gray('Usage: emit-infra r2:rotate-token <project-name>'))
        process.exit(1)
      }

      const credPath = join(credDir, projectName, 'terraform-backend.env')

      if (!existsSync(credPath)) {
        console.error(chalk.red(`No credentials file found at ${credPath}`))
        console.error(chalk.gray('Run "emit-infra setup" first to initialize the project'))
        process.exit(1)
      }

      const cfToken = process.env.TF_VAR_cloudflare_api_token
      if (!cfToken) {
        console.error(chalk.red('TF_VAR_cloudflare_api_token environment variable is not set'))
        console.error(chalk.gray('Export it before running this command, e.g.:'))
        console.error(chalk.gray('  export TF_VAR_cloudflare_api_token="<cf token>"'))
        process.exit(1)
      }

      console.log(chalk.bold(`\nRotating R2 token for ${chalk.cyan(projectName)}\n`))

      const existingContent = readFileSync(credPath, 'utf-8')
      const bucketMatch = existingContent.match(/^bucket=(.+)$/m)
      const endpointMatch = existingContent.match(/^endpoint=(.+)$/m)
      const tokenIdMatch = existingContent.match(/^token_id=(.+)$/m)

      if (!bucketMatch || !bucketMatch[1]) {
        console.error(chalk.red('Error: bucket not found in credentials file'))
        process.exit(1)
      }

      if (!endpointMatch || !endpointMatch[1]) {
        console.error(chalk.red('Error: endpoint not found in credentials file'))
        process.exit(1)
      }

      const bucket = bucketMatch[1]
      const endpoint = endpointMatch[1]
      const accountIdMatch = endpoint.match(/https:\/\/(.+)\.r2\.cloudflarestorage\.com/)
      if (!accountIdMatch || !accountIdMatch[1]) {
        console.error(chalk.red('Error: could not extract account ID from endpoint'))
        process.exit(1)
      }

      const accountId = accountIdMatch[1]

      if (tokenIdMatch && tokenIdMatch[1]) {
        const oldTokenId = tokenIdMatch[1]
        console.log(chalk.gray(`Revoking old token ${oldTokenId.slice(0, 8)}...`))
        const revoked = await revokeR2Token(cfToken, oldTokenId)
        if (revoked) {
          console.log(chalk.green(`  ✓ Revoked old token`))
        } else {
          console.log(chalk.yellow(`  ⚠ Could not revoke old token (it may already be deleted)`))
        }
      }

      console.log(chalk.gray(`Creating new token for bucket ${bucket}...`))
      const newToken = await createR2Token(accountId, bucket, cfToken)
      console.log(chalk.green(`  ✓ Created new token`))

      const newContent = [
        `bucket=${bucket}`,
        `access_key=${newToken.accessKeyId}`,
        `secret_key=${newToken.secretAccessKey}`,
        `endpoint=${endpoint}`,
        `token_id=${newToken.tokenId}`,
      ].join('\n') + '\n'
      writeFileSync(credPath, newContent, { mode: 0o600 })

      console.log(chalk.green.bold(`\n✓ R2 token rotated successfully\n`))
      console.log(`  Project:    ${projectName}`)
      console.log(`  Bucket:     ${bucket}`)
      console.log(`  New token:  ${newToken.tokenId.slice(0, 8)}...\n`)
    })
}
