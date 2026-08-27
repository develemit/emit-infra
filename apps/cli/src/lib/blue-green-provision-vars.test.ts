import { describe, it, expect } from 'vitest'
import type { ProjectConfig } from '@emit-infra/core'
import { buildBlueGreenProvisionVars } from './blue-green-provision-vars.js'

const baseConfig = {
  name: 'test-project',
  domain: 'test.com',
  region: 'nbg1' as const,
  serverType: 'cx22',
  sshKeyName: 'emit-deploy',
  github: { repo: 'user/test' },
} satisfies Partial<ProjectConfig>

describe('buildBlueGreenProvisionVars', () => {
  it('returns {} for a project with no blueGreen config', () => {
    expect(buildBlueGreenProvisionVars(baseConfig as ProjectConfig)).toEqual({})
  })

  it('sets blue_green and maps known service names to their slot-port vars', () => {
    const config = {
      ...baseConfig,
      blueGreen: {
        services: [
          { name: 'web', bluePort: 4300, greenPort: 4400 },
          { name: 'api', bluePort: 4301, greenPort: 4401 },
          { name: 'worker', bluePort: 4302, greenPort: 4402 },
          { name: 'marketing', bluePort: 4303, greenPort: 4403 },
        ],
        composeStructure: 'separate' as const,
      },
    } as ProjectConfig

    expect(buildBlueGreenProvisionVars(config)).toEqual({
      blue_green: true,
      blue_web_port: 4300,
      blue_api_port: 4301,
      blue_worker_port: 4302,
      blue_marketing_port: 4303,
    })
  })

  it('omits slot-port vars for services whose name has no known mapping', () => {
    // Regression: martialops names its marketing service "marketing-web", not
    // "marketing" — it falls back to the role's default port rather than
    // asserting an unmapped var.
    const config = {
      ...baseConfig,
      blueGreen: {
        services: [
          { name: 'web', bluePort: 4300, greenPort: 4400 },
          { name: 'marketing-web', bluePort: 4303, greenPort: 4403 },
        ],
        composeStructure: 'separate' as const,
      },
    } as ProjectConfig

    expect(buildBlueGreenProvisionVars(config)).toEqual({
      blue_green: true,
      blue_web_port: 4300,
    })
  })

  it('sets blue_green true with no port vars when services only cover unmapped names', () => {
    const config = {
      ...baseConfig,
      blueGreen: {
        services: [{ name: 'inbound', bluePort: 3003, greenPort: 3013 }],
        composeStructure: 'separate' as const,
      },
    } as ProjectConfig

    expect(buildBlueGreenProvisionVars(config)).toEqual({ blue_green: true })
  })
})
