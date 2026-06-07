import { Command } from 'commander'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import chalk from 'chalk'
import { loadConfig, sshExec } from '@emit-infra/core'

type Severity = 'critical' | 'warn' | 'info'

interface Issue {
  severity: Severity
  file: string
  message: string
  fix: string
}

const SEV_LABEL: Record<Severity, string> = {
  critical: chalk.bgRed.white(' CRIT '),
  warn:     chalk.bgYellow.black(' WARN '),
  info:     chalk.bgCyan.black(' INFO '),
}

// ─── local analysis ───────────────────────────────────────────────────────────

function findDockerfiles(projectDir: string): string[] {
  const candidates: string[] = []
  const searchDirs = [
    projectDir,
    join(projectDir, 'docker'),
  ]

  const appsDir = join(projectDir, 'apps')
  if (existsSync(appsDir)) {
    const appDirs = readdirSync(appsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => join(appsDir, d.name))
    searchDirs.push(...appDirs)
  }

  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) {
      if (f.startsWith('Dockerfile')) candidates.push(join(dir, f))
    }
  }
  return candidates
}

function auditDockerfile(filepath: string, content: string): Issue[] {
  const issues: Issue[] = []
  const rel = filepath.replace(process.cwd() + '/', '')
  const lines = content.split('\n')

  const stages = lines.filter(l => /^FROM\s+/i.test(l))
  const isMultiStage = stages.length > 1

  // Running dev server in production
  const cmdLine = lines.find(l => /^(CMD|ENTRYPOINT)\s+/i.test(l)) ?? ''
  if (/\bdev\b/i.test(cmdLine)) {
    issues.push({
      severity: 'critical',
      file: rel,
      message: `CMD runs dev server: ${cmdLine.trim()}`,
      fix: 'Build the app (e.g. "next build") in a builder stage and run "next start" or serve the standalone output.',
    })
  }

  // No multi-stage build
  if (!isMultiStage) {
    issues.push({
      severity: 'critical',
      file: rel,
      message: 'Single-stage build — all source files and devDependencies land in the final image.',
      fix: 'Use a multi-stage build: builder stage installs + compiles, final stage copies only the built output.',
    })
  }

  // pnpm install without --frozen-lockfile
  const installLines = lines.filter(l => /pnpm install/i.test(l))
  for (const il of installLines) {
    if (!il.includes('--frozen-lockfile')) {
      issues.push({
        severity: 'warn',
        file: rel,
        message: `pnpm install without --frozen-lockfile: ${il.trim()}`,
        fix: 'Replace with "pnpm install --frozen-lockfile" to enforce lockfile integrity in CI/CD.',
      })
    }
  }

  // npm install without --production / npm ci
  const npmLines = lines.filter(l => /npm install(?!.*--production)(?!.*--omit=dev)/i.test(l))
  if (npmLines.length && !lines.some(l => /npm ci/i.test(l))) {
    issues.push({
      severity: 'warn',
      file: rel,
      message: 'npm install without --production/--omit=dev in apparent final stage.',
      fix: 'Use "npm ci --omit=dev" or multi-stage to avoid shipping devDependencies.',
    })
  }

  // COPY . . without a .dockerignore nearby check is done separately
  if (lines.some(l => /^COPY\s+\.\s+\./i.test(l))) {
    issues.push({
      severity: 'info',
      file: rel,
      message: '"COPY . ." detected — verify .dockerignore excludes build artifacts and dev files.',
      fix: 'Ensure .dockerignore lists: node_modules, .git, **/*.ts (if not needed at runtime), test files, *.md.',
    })
  }

  return issues
}

const REQUIRED_IGNORES = ['.git', '**/*.test.*', '**/*.spec.*', '*.md', '.env*']

function auditDockerignore(projectDir: string): Issue[] {
  const path = join(projectDir, '.dockerignore')
  const file = '.dockerignore'
  if (!existsSync(path)) {
    return [{
      severity: 'critical',
      file,
      message: 'No .dockerignore file found.',
      fix: 'Create .dockerignore with at minimum: node_modules, .git, dist, .next, *.md, **/*.test.*, .env*',
    }]
  }
  const content = readFileSync(path, 'utf8')
  const missing = REQUIRED_IGNORES.filter(pat => !content.includes(pat.replace('**/', '')))
  if (!missing.length) return []
  return [{
    severity: 'warn',
    file,
    message: `Missing recommended exclusions: ${missing.join(', ')}`,
    fix: `Add these to .dockerignore to avoid shipping unnecessary files into the image.`,
  }]
}

// ─── remote analysis ──────────────────────────────────────────────────────────

interface RemoteImage { name: string; sizeStr: string; sizeMb: number }

function parseSizeMb(sizeStr: string): number {
  const n = parseFloat(sizeStr)
  if (/GB/i.test(sizeStr)) return n * 1024
  if (/MB/i.test(sizeStr)) return n
  if (/kB/i.test(sizeStr)) return n / 1024
  return 0
}

async function auditRemote(host: string, key: string, projectName: string): Promise<Issue[]> {
  const issues: Issue[] = []

  let raw: string
  try {
    // Pull image info directly from running containers — avoids name-matching issues
    // when compose service names differ from the project name.
    raw = await sshExec(
      host,
      `docker ps --format '{{.Names}}\t{{.Image}}' | while read line; do
        name=$(echo "$line" | cut -f1)
        img=$(echo "$line" | cut -f2)
        size=$(docker image inspect "$img" --format '{{.Size}}' 2>/dev/null)
        echo "$name\t$img\t$size"
      done`,
      key,
    )
  } catch {
    issues.push({
      severity: 'warn',
      file: 'remote',
      message: 'Could not SSH to check remote image sizes.',
      fix: 'Pass --key and --host, or run from a machine with SSH access.',
    })
    return issues
  }

  const images: RemoteImage[] = raw.split('\n')
    .filter(l => l.trim())
    .map(l => {
      const parts = l.split('\t')
      const bytes = parseInt(parts[2] ?? '0', 10)
      const sizeMb = bytes / (1024 * 1024)
      const sizeStr = sizeMb >= 1024
        ? `${(sizeMb / 1024).toFixed(2)} GB`
        : `${sizeMb.toFixed(0)} MB`
      return { name: parts[0] ?? '', sizeStr, sizeMb }
    })
    .filter(img => img.sizeMb > 0)

  for (const img of images) {
    if (img.sizeMb >= 1024) {
      issues.push({
        severity: 'critical',
        file: `container: ${img.name}`,
        message: `Image is ${img.sizeStr} — well above the ~400 MB target for a Next.js app.`,
        fix: 'Switch to a multi-stage build with Next.js standalone output. Expected size: 200–400 MB.',
      })
    } else if (img.sizeMb >= 500) {
      issues.push({
        severity: 'warn',
        file: `container: ${img.name}`,
        message: `Image is ${img.sizeStr} — larger than expected (target < 500 MB).`,
        fix: 'Review devDependencies in the final stage; consider multi-stage or standalone builds.',
      })
    }
  }

  if (!images.length) {
    issues.push({
      severity: 'info',
      file: 'remote',
      message: `No running containers found on ${host}.`,
      fix: 'Run "emit-infra deploy" first, or pass --host to target the correct server.',
    })
  }

  return issues
}

// ─── output ───────────────────────────────────────────────────────────────────

function printIssues(issues: Issue[]): void {
  const byFile = new Map<string, Issue[]>()
  for (const issue of issues) {
    const group = byFile.get(issue.file) ?? []
    group.push(issue)
    byFile.set(issue.file, group)
  }
  for (const [file, fileIssues] of byFile) {
    console.log('\n' + chalk.bold.underline(file))
    for (const issue of fileIssues) {
      console.log(`  ${SEV_LABEL[issue.severity]}  ${issue.message}`)
      console.log(chalk.dim(`           → ${issue.fix}`))
    }
  }
}

// ─── command ─────────────────────────────────────────────────────────────────

export function registerAudit(program: Command): void {
  program
    .command('audit [name]')
    .description('Audit Dockerfiles and remote images for size and production-readiness issues')
    .option('--config <path>', 'Path to .emit-infra.json')
    .option('--key <path>', 'SSH private key', join(homedir(), '.ssh', 'id_ed25519'))
    .option('--host <ip>', 'Server host (overrides config domain)')
    .option('--local', 'Skip remote SSH checks')
    .action(async (_name, opts: { config?: string; key: string; host?: string; local?: boolean }) => {
      const config = loadConfig(opts.config)
      const projectDir = process.cwd()

      console.log(chalk.cyan(`\naudit: ${chalk.bold(config.name)}\n`) + chalk.dim('─'.repeat(50)))

      const issues: Issue[] = []

      // Local checks
      const dockerfiles = findDockerfiles(projectDir)
      if (!dockerfiles.length) {
        console.log(chalk.yellow('No Dockerfiles found. Run from the project root.'))
        return
      }
      for (const df of dockerfiles) {
        issues.push(...auditDockerfile(df, readFileSync(df, 'utf8')))
      }
      issues.push(...auditDockerignore(projectDir))

      // Remote checks
      if (!opts.local) {
        const host = opts.host ?? config.serverIp ?? config.domain
        issues.push(...await auditRemote(host, opts.key, config.name))
      }

      printIssues(issues)

      const crits = issues.filter(i => i.severity === 'critical').length
      const warns = issues.filter(i => i.severity === 'warn').length
      const infos = issues.filter(i => i.severity === 'info').length

      console.log('\n' + chalk.dim('─'.repeat(50)))
      const summary = [
        crits && chalk.red(`${crits} critical`),
        warns && chalk.yellow(`${warns} warning${warns !== 1 ? 's' : ''}`),
        infos && chalk.cyan(`${infos} info`),
      ].filter(Boolean).join('  ')
      console.log(summary || chalk.green('No issues found.'))
      console.log()

      if (crits > 0) process.exit(1)
    })
}
