import { describe, it, expect } from 'vitest'
import { resolveImageName } from './image-name.js'

describe('resolveImageName', () => {
  it('uses imagePrefix when set (develemail shape)', () => {
    const config = { ci: { ghcrOrg: 'develemit', imagePrefix: 'develemail-' }, github: { repo: 'develemit/develemail' } }
    expect(resolveImageName(config, 'api')).toBe('ghcr.io/develemit/develemail-api')
  })

  it('uses imagePrefix when set (martialops shape)', () => {
    const config = { ci: { ghcrOrg: 'develemit', imagePrefix: 'martialops-' }, github: { repo: 'develemit/martialops' } }
    expect(resolveImageName(config, 'marketing-web')).toBe('ghcr.io/develemit/martialops-marketing-web')
  })

  it('uses <ghcrRepo>/<service> when there is no prefix (tastease shape)', () => {
    const config = { ci: { ghcrOrg: 'develemit', ghcrRepo: 'easyliving' }, github: { repo: 'develemit/easyliving' } }
    expect(resolveImageName(config, 'api')).toBe('ghcr.io/develemit/easyliving/api')
  })

  it('lets imagePrefix win over ghcrRepo', () => {
    const config = { ci: { ghcrOrg: 'org', ghcrRepo: 'repo', imagePrefix: 'p-' } }
    expect(resolveImageName(config, 'web')).toBe('ghcr.io/org/p-web')
  })

  it('falls back to the last segment of github.repo when ghcrRepo is unset', () => {
    const config = { ci: { ghcrOrg: 'org' }, github: { repo: 'org/widget' } }
    expect(resolveImageName(config, 'web')).toBe('ghcr.io/org/widget/web')
  })

  it('is bare <org>/<service> when there is no prefix, ghcrRepo, or github repo', () => {
    expect(resolveImageName({ ci: { ghcrOrg: 'org' } }, 'web')).toBe('ghcr.io/org/web')
  })
})
