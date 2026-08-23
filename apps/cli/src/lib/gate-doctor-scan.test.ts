import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { findGateProject } from './gate-doctor-scan.js'

const DEFAULT_TARGETS = ['lint', 'typecheck', 'test', 'build']

describe('findGateProject', () => {
  let rootsDir: string

  beforeEach(() => {
    rootsDir = mkdtempSync(join(tmpdir(), 'gate-doctor-scan-test-'))
  })

  afterEach(() => {
    rmSync(rootsDir, { recursive: true, force: true })
  })

  function writeProject(name: string, configContent: string): void {
    const repoPath = join(rootsDir, name)
    mkdirSync(repoPath, { recursive: true })
    writeFileSync(join(repoPath, '.emit-infra.json'), configContent)
  }

  it('returns null when .emit-infra.json is absent', () => {
    mkdirSync(join(rootsDir, 'no-config'))
    expect(findGateProject(rootsDir, 'no-config')).toBeNull()
  })

  it('uses the declared targets and reports no config issue for a valid array', () => {
    writeProject('valid', JSON.stringify({ ci: { prePush: ['lint', 'build'] } }))
    const project = findGateProject(rootsDir, 'valid')
    expect(project?.targets).toEqual(['lint', 'build'])
    expect(project?.configIssue).toBeUndefined()
  })

  it('falls back to defaults silently when ci.prePush is absent — matches the hook default', () => {
    writeProject('absent', JSON.stringify({ ci: {} }))
    const project = findGateProject(rootsDir, 'absent')
    expect(project?.targets).toEqual(DEFAULT_TARGETS)
    expect(project?.configIssue).toBeUndefined()
  })

  it('falls back to defaults silently when ci is missing entirely', () => {
    writeProject('no-ci', JSON.stringify({ name: 'x' }))
    const project = findGateProject(rootsDir, 'no-ci')
    expect(project?.targets).toEqual(DEFAULT_TARGETS)
    expect(project?.configIssue).toBeUndefined()
  })

  it('reports a malformed ci.prePush that is a bare string', () => {
    writeProject('bare-string', JSON.stringify({ ci: { prePush: 'lint' } }))
    const project = findGateProject(rootsDir, 'bare-string')
    expect(project?.targets).toEqual(DEFAULT_TARGETS)
    expect(project?.configIssue).toEqual({
      kind: 'malformed-pre-push',
      message: expect.stringContaining('a string'),
    })
  })

  it('reports a malformed ci.prePush that is a mixed array', () => {
    writeProject('mixed-array', JSON.stringify({ ci: { prePush: ['lint', 1, 'build'] } }))
    const project = findGateProject(rootsDir, 'mixed-array')
    expect(project?.targets).toEqual(DEFAULT_TARGETS)
    expect(project?.configIssue?.kind).toBe('malformed-pre-push')
    expect(project?.configIssue?.message).toContain('non-string entries')
  })

  it('reports a malformed ci.prePush that is an object', () => {
    writeProject('object-shape', JSON.stringify({ ci: { prePush: { lint: true } } }))
    const project = findGateProject(rootsDir, 'object-shape')
    expect(project?.targets).toEqual(DEFAULT_TARGETS)
    expect(project?.configIssue?.kind).toBe('malformed-pre-push')
    expect(project?.configIssue?.message).toContain('an object')
  })

  it('reports — rather than silently drops — an unparseable .emit-infra.json', () => {
    writeProject('bad-json', '{ not valid json')
    const project = findGateProject(rootsDir, 'bad-json')
    expect(project).not.toBeNull()
    expect(project?.targets).toEqual(DEFAULT_TARGETS)
    expect(project?.configIssue?.kind).toBe('unparseable-json')
    expect(project?.configIssue?.message).toContain('.emit-infra.json failed to parse')
  })
})
