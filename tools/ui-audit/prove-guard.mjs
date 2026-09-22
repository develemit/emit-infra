// Proves read-only-guard.mjs actually blocks writes before any audit agent is
// allowed to drive the dashboard. Two stages; stage 2 only runs if stage 1 passes.
//
//   1. Mechanics: a local sentinel server records every request that reaches
//      it. The guarded page fires every write shape (fetch, XHR, form post,
//      sendBeacon) plus an allowed GET and a backup-download GET. Only the
//      allowed GET may arrive.
//   2. Real button: click Deploy on test-smoke (domain 192.0.2.1, reserved and
//      unroutable, so even a leak could not reach a server). Assert the deploy
//      POST was blocked, no `emit-infra deploy test-smoke` process started, and
//      the test-smoke project directory is unchanged.
//
// Usage: PLAYWRIGHT_PATH=<dir of the playwright package> node tools/ui-audit/prove-guard.mjs

import { createServer } from 'node:http'
import { execSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { newGuardedContext } from './read-only-guard.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? 'playwright')
const APP = process.env.APP_URL ?? 'http://localhost:7013'
const LOG = join(process.cwd(), '.ui-audit', 'guard-proof-blocked.jsonl')
const SENTINEL_PORT = 7098
const SMOKE_DIR = join(homedir(), 'projects', 'test-smoke')

let failures = 0
const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) failures++ }

function snapshotDir(dir) {
  return readdirSync(dir).map((f) => `${f}:${statSync(join(dir, f)).mtimeMs}`).sort().join('|')
}

function deployProcessRunning() {
  try { return execSync('pgrep -fl "emit-infra deploy test-smoke"', { encoding: 'utf8' }).trim().length > 0 } catch { return false }
}

async function stageMechanics(browser) {
  const arrived = []
  const server = createServer((req, res) => {
    arrived.push(`${req.method} ${req.url}`)
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*' }).end('ok')
  })
  await new Promise((r) => server.listen(SENTINEL_PORT, '127.0.0.1', r))
  const s = `http://127.0.0.1:${SENTINEL_PORT}`

  const { context, blocked } = await newGuardedContext(browser, { logFile: LOG })
  const page = await context.newPage()
  await page.goto(APP, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async (s) => {
    const quiet = (p) => p.catch(() => {})
    await quiet(fetch(`${s}/allowed-get`, { mode: 'no-cors' }))
    await quiet(fetch(`${s}/fetch-post`, { method: 'POST', mode: 'no-cors', body: 'x' }))
    for (const m of ['PUT', 'PATCH', 'DELETE']) await quiet(fetch(`${s}/fetch-${m}`, { method: m }))
    await new Promise((r) => { const x = new XMLHttpRequest(); x.open('POST', `${s}/xhr-post`); x.onloadend = r; x.send('x') })
    navigator.sendBeacon(`${s}/beacon`, 'x')
    await quiet(fetch(`${s}/projects/p/backups/k/download`, { mode: 'no-cors' }))
    const iframe = Object.assign(document.createElement('iframe'), { name: 'sink' })
    document.body.append(iframe)
    const form = Object.assign(document.createElement('form'), { method: 'POST', action: `${s}/form-post`, target: 'sink' })
    document.body.append(form); form.submit()
  }, s)
  await page.waitForTimeout(2000)
  await context.close()
  server.close()

  check(arrived.length === 1 && arrived[0] === 'GET /allowed-get', `sentinel received only the allowed GET (got: ${JSON.stringify(arrived)})`)
  for (const shape of ['fetch-post', 'fetch-PUT', 'fetch-PATCH', 'fetch-DELETE', 'xhr-post', 'beacon', 'form-post', '/download']) {
    check(blocked.some((b) => b.url.includes(shape)), `blocked: ${shape}`)
  }
}

async function stageRealDeploy(browser) {
  const before = snapshotDir(SMOKE_DIR)
  check(!deployProcessRunning(), 'no test-smoke deploy process before the click')

  const { context, blocked } = await newGuardedContext(browser, { logFile: LOG, viewport: { width: 1440, height: 900 } })
  // test-smoke is unreachable, so the page renders its "SSH unreachable" branch
  // and never mounts the deploy panel that sends the request. Serve a healthy
  // status (tastease's real shape) for it so the real Deploy flow runs; the
  // target stays test-smoke. Registered after the guard, so it takes precedence
  // for this one GET and falls back to the guard for everything else.
  const healthy = await fetch(`${process.env.API_ORIGIN ?? 'http://localhost:7001'}/projects/tastease/status`).then((r) => r.json())
  await context.route('**/projects/test-smoke/status', (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: { ...healthy, disk: 20, memory: 20 } }) : route.fallback())
  const page = await context.newPage()
  await page.goto(`${APP}/projects/test-smoke`, { waitUntil: 'networkidle' })
  const button = page.getByRole('button', { name: 'Deploy', exact: true }).first()
  await button.click()
  // Deploy click always opens a confirm dialog now (sprint 349); its own
  // "Deploy" button is the second match on the page.
  await page.getByRole('button', { name: 'Deploy', exact: true }).last().click()

  let leaked = false
  for (let i = 0; i < 10; i++) { if (deployProcessRunning()) leaked = true; await page.waitForTimeout(1000) }
  await page.screenshot({ path: join(process.cwd(), '.ui-audit', 'guard-proof-deploy-click.png') })
  await context.close()

  check(blocked.some((b) => b.method === 'POST' && b.url.includes('/projects/test-smoke/deploy')), 'Deploy click fired POST /projects/test-smoke/deploy and it was blocked')
  check(!leaked, 'no `emit-infra deploy test-smoke` process appeared in the 10s after the click')
  check(snapshotDir(SMOKE_DIR) === before, 'test-smoke project directory unchanged')
}

const browser = await chromium.launch()
try {
  console.log('── stage 1: guard mechanics against a local sentinel')
  await stageMechanics(browser)
  if (failures) { console.log(`\nSTAGE 1 FAILED (${failures}) — not clicking any real button.`); process.exitCode = 1 }
  else {
    console.log('\n── stage 2: real Deploy click on test-smoke')
    await stageRealDeploy(browser)
    console.log(failures ? `\nGUARD PROOF FAILED (${failures})` : '\nGUARD PROOF PASSED')
    process.exitCode = failures ? 1 : 0
  }
} finally {
  await browser.close()
}
