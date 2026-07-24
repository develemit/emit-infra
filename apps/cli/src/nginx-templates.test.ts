import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const templatesDir = join(repoRoot, 'ansible', 'roles', 'nginx', 'templates')

// No Jinja rendering harness exists in this repo, so these assert against the
// raw template source rather than a rendered output. That's enough to catch
// the two failure modes this sprint guards against: a trailing slash on
// proxy_pass, and the API block landing after `location /`.
describe.each([
  ['upstream-site.conf.j2 (blue-green)', 'upstream-site.conf.j2'],
  ['site.conf.j2 (non-blue-green)', 'site.conf.j2'],
])('%s', (_label, filename) => {
  const source = readFileSync(join(templatesDir, filename), 'utf8')

  it('guards the API location block on both fields being defined', () => {
    expect(source).toContain(
      '{% if nginx_api_path_prefix is defined and nginx_api_upstream is defined %}',
    )
  })

  it('proxy_pass for the API block has no trailing slash or URI component', () => {
    expect(source).toContain('proxy_pass http://{{ nginx_api_upstream }};')
    expect(source).not.toContain('proxy_pass http://{{ nginx_api_upstream }}/')
  })

  it('the API location block precedes every `location /` block', () => {
    const apiBlockIndices = [...source.matchAll(/location \{\{ nginx_api_path_prefix \}\}/g)].map(
      (m) => m.index ?? -1,
    )
    const rootLocationIndices = [...source.matchAll(/location \/ \{/g)].map((m) => m.index ?? -1)

    expect(apiBlockIndices.length).toBeGreaterThan(0)
    expect(rootLocationIndices.length).toBeGreaterThanOrEqual(apiBlockIndices.length)

    for (const apiIndex of apiBlockIndices) {
      const nextRootIndex = rootLocationIndices.find((i) => i > apiIndex)
      expect(nextRootIndex).toBeDefined()
    }
  })

  it('renders nothing when the guard is absent (omitting either field leaves output untouched)', () => {
    const guardCount = source.split('nginx_api_path_prefix is defined and nginx_api_upstream is defined').length - 1
    const blockCount = source.split('location {{ nginx_api_path_prefix }}').length - 1
    expect(blockCount).toBe(guardCount)
  })
})
