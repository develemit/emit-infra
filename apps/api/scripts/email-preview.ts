import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderHealthEmail } from '../src/lib/email-templates/health.js'
import { renderAlertRuleEmail } from '../src/lib/email-templates/alert-rule.js'
import { renderDeployFailedEmail } from '../src/lib/email-templates/deploy.js'
import { renderDigestEmail } from '../src/lib/email-templates/digest.js'
import * as f from '../src/lib/email-templates/fixtures.js'

const outDir = resolve(process.cwd(), 'tmp/email-preview')
mkdirSync(outDir, { recursive: true })

const previews = {
  'health-down': renderHealthEmail(f.healthDown),
  'health-recovered': renderHealthEmail(f.healthRecovered),
  'alert-rule': renderAlertRuleEmail(f.alertRule),
  deploy: renderDeployFailedEmail(f.deployFailed),
  digest: renderDigestEmail(f.digest),
}

for (const [name, email] of Object.entries(previews)) {
  const path = resolve(outDir, `${name}.html`)
  writeFileSync(path, email.html)
  console.log(`${email.subject}\n  ${path}`)
}
