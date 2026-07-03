import { Command } from 'commander'
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import chalk from 'chalk'
import { detectServices, detectHealthPaths, type DetectedService } from '../lib/detect-project.js'

interface InitDeployOpts {
  portBase: string
  compose: 'separate' | 'profiles'
  migratePre?: string | undefined
  migratePost?: string | undefined
  yes: boolean
}

export function registerInitDeploy(program: Command): void {
  program
    .command('init-deploy')
    .description('Scaffold blue-green deploy config, compose files, and CI workflow for an existing project')
    .option('--port-base <port>', 'Starting port for blue slot (green = +100)', '3000')
    .option('--compose <structure>', 'Compose structure: separate or profiles', 'separate')
    .option('--migrate-pre <cmd>', 'Pre-deploy migration command')
    .option('--migrate-post <cmd>', 'Post-deploy migration command')
    .option('-y, --yes', 'Skip confirmation', false)
    .action((opts: InitDeployOpts) => {
      const cwd = process.cwd()
      const configPath = join(cwd, '.emit-infra.json')

      if (!existsSync(configPath)) {
        console.error(chalk.red('No .emit-infra.json found. Run "emit-infra init <name>" first.'))
        process.exit(1)
      }

      const config = JSON.parse(readFileSync(configPath, 'utf-8'))
      const projectName: string = config.name

      console.log(chalk.cyan(`Scaffolding deploy infrastructure for ${chalk.bold(projectName)}\n`))

      const services = detectServices(cwd)
      const healthPaths = detectHealthPaths(cwd)
      const portBase = parseInt(opts.portBase, 10)

      const blueGreenServices = services.map((svc, i) => ({
        name: svc.name,
        bluePort: portBase + i,
        greenPort: portBase + 100 + i,
        ...(healthPaths[svc.name] ? { healthPath: healthPaths[svc.name] } : {}),
      }))

      console.log(chalk.cyan('Detected services:'))
      for (const svc of blueGreenServices) {
        const hp = 'healthPath' in svc ? svc.healthPath : 'skip'
        console.log(`  ${svc.name}: blue=${svc.bluePort} green=${svc.greenPort} health=${hp}`)
      }
      console.log()

      config.blueGreen = {
        services: blueGreenServices,
        composeStructure: opts.compose,
        ...(opts.migratePre ? { migratePre: opts.migratePre } : {}),
        ...(opts.migratePost ? { migratePost: opts.migratePost } : {}),
      }

      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
      console.log(chalk.green(`Updated ${configPath} with blueGreen config`))

      if (opts.compose === 'separate') {
        scaffoldSeparateCompose(cwd, projectName, services, blueGreenServices)
      }

      scaffoldDeployWorkflow(cwd, projectName, services)

      printChecklist(projectName, config.domain)
    })
}

function scaffoldSeparateCompose(
  cwd: string,
  projectName: string,
  services: DetectedService[],
  blueGreen: { name: string; bluePort: number; greenPort: number }[],
): void {
  const blueFile = join(cwd, 'docker-compose.blue.yml')
  const greenFile = join(cwd, 'docker-compose.green.yml')

  if (existsSync(blueFile) && existsSync(greenFile)) {
    console.log(chalk.yellow('Blue/green compose files already exist — skipping'))
    return
  }

  const buildBlotCompose = (slot: 'blue' | 'green'): string => {
    const lines = ['services:']
    for (const svc of blueGreen) {
      const port = slot === 'blue' ? svc.bluePort : svc.greenPort
      const detected = services.find((s) => s.name === svc.name)
      const internalPort = detected?.internalPort ?? port
      lines.push(`  ${svc.name}:`)
      lines.push(`    ports:`)
      lines.push(`      - "${port}:${internalPort}"`)
    }
    return lines.join('\n') + '\n'
  }

  writeFileSync(blueFile, buildBlotCompose('blue'))
  console.log(chalk.green(`Created ${basename(blueFile)}`))

  writeFileSync(greenFile, buildBlotCompose('green'))
  console.log(chalk.green(`Created ${basename(greenFile)}`))
}

function scaffoldDeployWorkflow(cwd: string, projectName: string, services: DetectedService[]): void {
  const workflowDir = join(cwd, '.github', 'workflows')
  const workflowPath = join(workflowDir, 'deploy.yml')

  if (existsSync(workflowPath)) {
    console.log(chalk.yellow('deploy.yml already exists — skipping'))
    return
  }

  mkdirSync(workflowDir, { recursive: true })

  const buildJobs = services
    .map(
      (svc) => `
  build-${svc.name}:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: apps/${svc.name}/Dockerfile
          push: true
          tags: |
            ghcr.io/\${{ github.repository }}/${svc.name}:\${{ github.run_number }}
            ghcr.io/\${{ github.repository }}/${svc.name}:latest
          build-args: BUILD_NUMBER=\${{ github.run_number }}
          cache-from: type=gha,scope=${svc.name}
          cache-to: type=gha,mode=max,scope=${svc.name}`,
    )
    .join('\n')

  const buildNeeds = services.map((s) => `build-${s.name}`).join(', ')

  const workflow = `name: Deploy

on:
  push:
    branches: [main]

jobs:${buildJobs}

  deploy:
    name: Deploy via emit-infra
    needs: [${buildNeeds}]
    runs-on: ubuntu-latest
    steps:
      - name: Trigger deploy
        run: |
          curl -sf -X POST \\
            "\${{ secrets.EMIT_INFRA_API_URL }}/projects/${projectName}/deploy" \\
            -H "Authorization: Bearer \${{ secrets.EMIT_INFRA_API_TOKEN }}" \\
            -H "Content-Type: application/json" \\
            -d "{\\"sha\\": \\"\${{ github.sha }}\\", \\"branch\\": \\"\${{ github.ref_name }}\\", \\"buildNumber\\": \\"\${{ github.run_number }}\\"}"

      - name: Poll deploy status
        run: |
          for i in $(seq 1 60); do
            STATUS=$(curl -sf \\
              "\${{ secrets.EMIT_INFRA_API_URL }}/projects/${projectName}/deploy-status" \\
              -H "Authorization: Bearer \${{ secrets.EMIT_INFRA_API_TOKEN }}" \\
              | jq -r '.status')
            echo "Attempt $i: status=$STATUS"
            case "$STATUS" in
              completed) echo "Deploy succeeded"; exit 0 ;;
              failed) echo "Deploy failed"; exit 1 ;;
              *) sleep 10 ;;
            esac
          done
          echo "Timed out waiting for deploy"
          exit 1
`

  writeFileSync(workflowPath, workflow)
  console.log(chalk.green('Created .github/workflows/deploy.yml'))
}

function printChecklist(projectName: string, domain?: string): void {
  console.log(chalk.cyan('\nManual steps remaining:'))
  console.log(`  1. Provision the server:       emit-infra provision ${projectName}`)
  console.log(`  2. Configure the server:       emit-infra configure ${projectName}`)
  console.log(`  3. Set up DNS for ${domain ?? projectName + '.com'}`)
  console.log(`  4. Add GitHub secrets:`)
  console.log(`     - EMIT_INFRA_API_URL        (URL of your emit-infra API)`)
  console.log(`     - EMIT_INFRA_API_TOKEN      (API auth token)`)
  console.log(`  5. Push to main to trigger first deploy`)
  console.log(`  6. Verify:                     curl https://${domain ?? projectName + '.com'}/healthz`)
}
