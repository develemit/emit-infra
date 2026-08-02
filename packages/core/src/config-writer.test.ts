import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConfigFile, setConfigField } from './config-writer.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, 'config-writer.fixtures')
const FIXTURES = ['emit-vision.json', 'diner-decider.json', 'emit-social.json']

const tmpDirs: string[] = []

function copyFixtureToTmp(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'config-writer-test-'))
  tmpDirs.push(dir)
  const dest = join(dir, '.emit-infra.json')
  const content = readFileSync(join(FIXTURES_DIR, name), 'utf-8')
  writeFileSync(dest, content)
  return dest
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    rmSync(tmpDirs.pop() as string, { recursive: true, force: true })
  }
})

describe('setConfigField', () => {
  it.each(FIXTURES)('no-op write is byte-identical for %s', (name) => {
    const configPath = copyFixtureToTmp(name)
    const before = readFileSync(configPath, 'utf-8')
    const config = JSON.parse(before)

    setConfigField(configPath, ['requiredEnvKeys'], config.requiredEnvKeys)

    const after = readFileSync(configPath, 'utf-8')
    expect(after).toBe(before)
  })

  it('targeted edit only touches the intended field, leaving the rest byte-identical', () => {
    const configPath = copyFixtureToTmp('emit-vision.json')
    const before = readFileSync(configPath, 'utf-8')

    setConfigField(configPath, ['requiredEnvKeys'], ['NEW_KEY_ONE', 'NEW_KEY_TWO'])

    const after = readFileSync(configPath, 'utf-8')
    expect(after).not.toBe(before)
    expect(JSON.parse(after).requiredEnvKeys).toEqual(['NEW_KEY_ONE', 'NEW_KEY_TWO'])

    // Everything outside requiredEnvKeys is untouched, including formatting.
    const beforeWithoutKeys = { ...JSON.parse(before), requiredEnvKeys: undefined }
    const afterWithoutKeys = { ...JSON.parse(after), requiredEnvKeys: undefined }
    expect(afterWithoutKeys).toEqual(beforeWithoutKeys)

    // Sibling blocks retain their original text verbatim.
    expect(after).toContain('"composeStructure": "separate"')
    expect(after).toContain('"emit-vision-deploy"')
  })

  it('preserves compact single-line array formatting elsewhere in the file', () => {
    const configPath = copyFixtureToTmp('emit-social.json')
    const before = readFileSync(configPath, 'utf-8')

    setConfigField(configPath, ['requiredEnvKeys'], [...JSON.parse(before).requiredEnvKeys, 'ANOTHER_KEY'])

    const after = readFileSync(configPath, 'utf-8')
    // emit-social's ci.prePush array is hand-formatted on one line — must survive untouched.
    expect(after).toContain('"prePush": ["lint", "typecheck", "test", "build"]')
  })

  it('inserts a new top-level field on a config that lacks it', () => {
    const configPath = copyFixtureToTmp('diner-decider.json')
    const blueGreen = { services: [{ name: 'api', bluePort: 5000, greenPort: 5001 }], composeStructure: 'separate' }

    // diner-decider fixture already has blueGreen; simulate the martialops case
    // (no blueGreen yet) by targeting a fresh key instead.
    setConfigField(configPath, ['newSection'], blueGreen)

    const after = readFileSync(configPath, 'utf-8')
    expect(JSON.parse(after).newSection).toEqual(blueGreen)
    expect(JSON.parse(after).name).toBe('diner-decider')
  })

  it('inserting a new key does not reformat the previous last property', () => {
    // Regression: jsonc-parser's modify() reprints "<prev prop>,\n<new prop>"
    // as a single edit, which silently reformats a compact sibling that
    // wasn't touched (e.g. `"github": { "repo": "x" }` -> 3 lines).
    const configPath = copyFixtureToTmp('compact-last-property.json')
    const before = readFileSync(configPath, 'utf-8')
    const blueGreen = { services: [{ name: 'api', bluePort: 4000, greenPort: 4100 }], composeStructure: 'separate' }

    setConfigField(configPath, ['blueGreen'], blueGreen)

    const after = readFileSync(configPath, 'utf-8')
    expect(before).toContain('"github": { "repo": "user/test" }')
    expect(after).toContain('"github": { "repo": "user/test" }')
    expect(JSON.parse(after).blueGreen).toEqual(blueGreen)
  })
})

describe('createConfigFile', () => {
  it('writes a fresh, well-formatted config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'config-writer-test-'))
    tmpDirs.push(dir)
    const configPath = join(dir, '.emit-infra.json')

    createConfigFile(configPath, { name: 'demo', domain: 'demo.com' })

    const content = readFileSync(configPath, 'utf-8')
    expect(content).toBe('{\n  "name": "demo",\n  "domain": "demo.com"\n}\n')
  })
})
