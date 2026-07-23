import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { oneLine, buildStatusCommand, parseStatusLines, STATUS_FIELDS } from './status-command.js'

function runShell(script: string): string {
  return execFileSync('sh', ['-c', script], { encoding: 'utf8' })
}

function lineCount(output: string): number {
  return output.split('\n').length - 1
}

describe('oneLine', () => {
  let dir: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'status-command-'))
    writeFileSync(join(dir, 'no-newline'), '960')
    writeFileSync(join(dir, 'with-newline'), '960\n')
    writeFileSync(join(dir, 'multi-line'), 'a\nb\nc\n')
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('emits exactly one line for a file with no trailing newline', () => {
    const out = runShell(oneLine(`cat ${join(dir, 'no-newline')} 2>/dev/null`))
    expect(out).toBe('960\n')
    expect(lineCount(out)).toBe(1)
  })

  it('emits exactly one line for a file that already ends in a newline', () => {
    const out = runShell(oneLine(`cat ${join(dir, 'with-newline')} 2>/dev/null`))
    expect(out).toBe('960\n')
  })

  it('emits exactly one line for a missing file', () => {
    const out = runShell(oneLine(`cat ${join(dir, 'nope')} 2>/dev/null`))
    expect(out).toBe('\n')
  })

  it('caps multi-line output at one line', () => {
    const out = runShell(oneLine(`cat ${join(dir, 'multi-line')} 2>/dev/null`))
    expect(out).toBe('a\n')
  })

  it('emits one line for a pipeline whose last stage exits 0 after an upstream failure', () => {
    // The real sslExpiry shape: openssl fails, sed still succeeds, so a
    // trailing `|| echo ""` never fires and the field emitted zero lines.
    const out = runShell(oneLine(`cat /definitely/missing 2>/dev/null | sed 's/x//'`))
    expect(out).toBe('\n')
  })

  it('does not interpret backslashes in command output as escapes', () => {
    const out = runShell(oneLine(`printf 'a\\\\tb'`))
    expect(out).toBe('a\\tb\n')
  })

  it('two consecutive fields stay on separate lines even when the first lacks a newline', () => {
    const script = [
      oneLine(`cat ${join(dir, 'no-newline')} 2>/dev/null`),
      oneLine('echo active'),
    ].join('; ')
    expect(runShell(script)).toBe('960\nactive\n')
  })
})

describe('buildStatusCommand', () => {
  // Executed against the real remote host, not here — asserting on structure
  // keeps this hermetic. The one-line guarantee itself is proven above.
  it('wraps every field so the output is one line per field', () => {
    const segments = buildStatusCommand('app', 'app.example.com').split('; printf ')
    expect(segments).toHaveLength(STATUS_FIELDS.length)
    expect(buildStatusCommand('app', 'app.example.com').startsWith(`printf '%s\\n' "$(`)).toBe(true)
  })

  it('reads the marker files that previously fused onto neighbouring fields', () => {
    const command = buildStatusCommand('app', 'app.example.com')
    expect(command).toContain(oneLine('cat /opt/app/.deployed-version 2>/dev/null'))
    expect(command).toContain(oneLine('cat /opt/app/.deployed-at 2>/dev/null'))
    expect(command).toContain(oneLine('cat /opt/app/.active-slot 2>/dev/null'))
  })

  it('probes the letsencrypt cert only for hostname-shaped domains', () => {
    expect(buildStatusCommand('app', 'app.example.com')).toContain('/etc/letsencrypt/live/app.example.com/')
    expect(buildStatusCommand('app', '1.2.3.4')).not.toContain('letsencrypt')
  })
})

describe('parseStatusLines', () => {
  it('maps lines onto fields positionally', () => {
    const raw = STATUS_FIELDS.map((_, i) => `v${i}`).join('\n')
    const fields = parseStatusLines(raw)
    expect(fields.uptime).toBe('v0')
    expect(fields.buildNumber).toBe('v6')
    expect(fields.activeSlot).toBe(`v${STATUS_FIELDS.length - 1}`)
  })

  it('defaults missing trailing fields to empty strings', () => {
    const fields = parseStatusLines('up 2 days')
    expect(fields.uptime).toBe('up 2 days')
    expect(fields.activeSlot).toBe('')
    expect(fields.sslExpiry).toBe('')
  })
})
