import { describe, it, expect } from 'vitest'
import { redactSecrets } from './redact.js'

describe('redactSecrets', () => {
  it('redacts a top-level secret value, keeping the key visible', () => {
    const result = redactSecrets({ ghcr_token: 'gho_livevalue', project_name: 'demo' })

    expect(result).toEqual({ ghcr_token: '<redacted>', project_name: 'demo' })
  })

  it('redacts secrets nested inside an object without collapsing the container', () => {
    const result = redactSecrets({
      r2_credentials: {
        CF_ACCOUNT_ID: 'acct-123',
        R2_ACCESS_KEY_ID: 'access-key-id',
        R2_SECRET_ACCESS_KEY: 'super-secret-value',
      },
    })

    expect(result).toEqual({
      r2_credentials: {
        CF_ACCOUNT_ID: 'acct-123',
        R2_ACCESS_KEY_ID: '<redacted>',
        R2_SECRET_ACCESS_KEY: '<redacted>',
      },
    })
  })

  it('redacts a dynamically-named per-bucket secret key', () => {
    const result = redactSecrets({
      r2_credentials: { R2_MYBUCKET_SECRET_ACCESS_KEY: 'super-secret-value' },
    })

    expect(result).toEqual({
      r2_credentials: { R2_MYBUCKET_SECRET_ACCESS_KEY: '<redacted>' },
    })
  })

  it('leaves non-secret keys untouched', () => {
    const result = redactSecrets({ compose_src: '/app/docker-compose.yml', build_number: '42' })

    expect(result).toEqual({ compose_src: '/app/docker-compose.yml', build_number: '42' })
  })

  it('does not redact ssh_key_name — it is a reference to a key, not the key value', () => {
    const result = redactSecrets({ ssh_key_name: 'emit-deploy', sshKeyName: 'emit-deploy' })

    expect(result).toEqual({ ssh_key_name: 'emit-deploy', sshKeyName: 'emit-deploy' })
  })

  it('does not mutate the input object', () => {
    const original = { ghcr_token: 'gho_livevalue', nested: { R2_SECRET_ACCESS_KEY: 'secretvalue' } }
    const snapshot = JSON.parse(JSON.stringify(original))

    redactSecrets(original)

    expect(original).toEqual(snapshot)
  })

  it('recurses into arrays without redacting non-secret array contents', () => {
    const result = redactSecrets({
      extra_files: [{ src: '/a', dest: '/b', dir: false }],
    })

    expect(result).toEqual({
      extra_files: [{ src: '/a', dest: '/b', dir: false }],
    })
  })
})
