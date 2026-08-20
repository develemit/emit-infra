#!/usr/bin/env node
// classify-run-state.mjs <status-file-path>
//
// Thin CLI wrapper around @emit-infra/core's classifyRunState (sprint 284),
// so bash callers get the same running/orphaned/idle/unknown verdict the
// dashboard and `emit-infra status` use, instead of a second heartbeat/pid
// staleness heuristic drifting out of sync with the real one. Prints one
// word (the RunState) to stdout; a missing or malformed status file reads as
// no record, same as classifyRunState(undefined).
//
// Usage: node classify-run-state.mjs /path/to/.deploy-status.json

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const { classifyRunState } = await import(join(here, '..', '..', 'packages', 'core', 'dist', 'src', 'index.js'))

const file = process.argv[2]
if (!file) {
  console.error('usage: classify-run-state.mjs <status-file-path>')
  process.exit(1)
}

let record = null
try {
  record = JSON.parse(await readFile(file, 'utf8'))
} catch {
  record = null
}

console.log(classifyRunState(record).state)
