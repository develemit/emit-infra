// Read-only guard for browser-driven audits of the emit-infra dashboard.
//
// The dashboard's buttons deploy, roll back, destroy servers, delete backups
// and edit firewall/cron rules on production. Audits must be able to click
// through those flows without any of them reaching the API, so this blocks at
// the browser's network layer rather than relying on agents to behave.
//
// Every non-GET/HEAD/OPTIONS request is aborted, which covers fetch, XHR, form
// posts, sendBeacon and the POST-based SSE streams all actions use. Backup
// downloads are GETs but copy production database dumps to disk, so they are
// blocked by URL. Service workers must be blocked when the context is created
// (see newGuardedContext): requests a service worker handles bypass
// context.route entirely.

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const BLOCKED_GET_PATTERNS = [/\/backups\/[^/]+\/download/]

export function shouldBlock(method, url) {
  if (!ALLOWED_METHODS.has(method.toUpperCase())) return true
  return BLOCKED_GET_PATTERNS.some((re) => re.test(url))
}

export async function installReadOnlyGuard(context, { logFile } = {}) {
  if (logFile) mkdirSync(dirname(logFile), { recursive: true })
  const blocked = []
  await context.route('**/*', async (route) => {
    const req = route.request()
    if (!shouldBlock(req.method(), req.url())) return route.continue()
    const entry = { at: new Date().toISOString(), method: req.method(), url: req.url(), page: req.frame()?.url?.() ?? null }
    blocked.push(entry)
    if (logFile) appendFileSync(logFile, JSON.stringify(entry) + '\n')
    return route.abort('blockedbyclient')
  })
  return blocked
}

export async function newGuardedContext(browser, { logFile, ...contextOptions } = {}) {
  const context = await browser.newContext({ ...contextOptions, serviceWorkers: 'block' })
  const blocked = await installReadOnlyGuard(context, { logFile })
  return { context, blocked }
}

// Call once per page before interacting. Fires a POST at a route that doesn't
// exist and throws unless the guard caught it, so a script that somehow built
// an unguarded context fails before touching anything real.
export async function assertGuardActive(page, blocked) {
  const before = blocked.length
  await page.evaluate(() => fetch('/api/__ui-audit-guard-canary', { method: 'POST' }).catch(() => {}))
  await page.waitForTimeout(200)
  if (!blocked.slice(before).some((b) => b.url.includes('__ui-audit-guard-canary'))) {
    throw new Error('read-only guard is NOT active on this page; stopping before any interaction')
  }
}
