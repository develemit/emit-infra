import { describe, it, expect } from 'vitest'
import { buildBackendConfigArgs, parseTerraformBackendCredFile } from './terraform-backend-config.js'

const validFile = [
  'bucket=my-project-tfstate',
  'access_key=abc123',
  'secret_key=def456',
  'endpoint=https://acct.r2.cloudflarestorage.com',
  'token_id=tok_789',
].join('\n') + '\n'

describe('parseTerraformBackendCredFile', () => {
  it('parses key=value lines into a record', () => {
    expect(parseTerraformBackendCredFile(validFile)).toEqual({
      bucket: 'my-project-tfstate',
      access_key: 'abc123',
      secret_key: 'def456',
      endpoint: 'https://acct.r2.cloudflarestorage.com',
      token_id: 'tok_789',
    })
  })

  it('ignores blank lines', () => {
    const withBlanks = `access_key=abc\n\nsecret_key=def\n\n`
    expect(parseTerraformBackendCredFile(withBlanks)).toEqual({
      access_key: 'abc',
      secret_key: 'def',
    })
  })

  it('throws a clear error on a malformed line rather than an opaque parse failure', () => {
    const malformed = 'access_key=abc\nnot-a-key-value-line\nsecret_key=def\n'
    expect(() => parseTerraformBackendCredFile(malformed)).toThrow(
      /Malformed line in terraform-backend\.env/,
    )
  })

  it('preserves = characters inside the value', () => {
    const withEquals = 'access_key=abc\nsecret_key=de=f==\n'
    expect(parseTerraformBackendCredFile(withEquals)).toEqual({
      access_key: 'abc',
      secret_key: 'de=f==',
    })
  })
})

describe('buildBackendConfigArgs', () => {
  it('builds discrete -backend-config args for access_key and secret_key only', () => {
    expect(buildBackendConfigArgs(validFile)).toEqual([
      '-backend-config=access_key=abc123',
      '-backend-config=secret_key=def456',
    ])
  })

  it('excludes token_id', () => {
    const args = buildBackendConfigArgs(validFile)
    expect(args.some((a) => a.includes('token_id'))).toBe(false)
  })

  it('excludes keys backend.tf already sets (bucket, endpoint)', () => {
    const args = buildBackendConfigArgs(validFile)
    expect(args.some((a) => a.includes('bucket='))).toBe(false)
    expect(args.some((a) => a.includes('endpoint='))).toBe(false)
  })

  it('throws a clear error when required keys are missing', () => {
    const missingSecret = 'bucket=my-project-tfstate\naccess_key=abc123\n'
    expect(() => buildBackendConfigArgs(missingSecret)).toThrow(
      /missing required key\(s\): secret_key/,
    )
  })

  it('throws on a tampered/malformed file instead of letting Terraform fail opaquely', () => {
    const tampered = 'access_key=abc123\nsecret_key\n'
    expect(() => buildBackendConfigArgs(tampered)).toThrow(
      /Malformed line in terraform-backend\.env/,
    )
  })
})
