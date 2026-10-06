import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderSample, SAMPLE_KINDS } from '../src/lib/email-templates/fixtures.js'

const outDir = resolve(process.cwd(), 'tmp/email-preview')
mkdirSync(outDir, { recursive: true })

const previews = Object.fromEntries(SAMPLE_KINDS.map((k) => [k, renderSample(k)]))

for (const [name, email] of Object.entries(previews)) {
  const path = resolve(outDir, `${name}.html`)
  writeFileSync(path, email.html)
  console.log(`${email.subject}\n  ${path}`)
}
