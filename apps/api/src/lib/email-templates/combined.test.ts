import { describe, it, expect } from 'vitest'
import { renderHealthEmail } from './health.js'
import { healthDown } from './fixtures.js'
import { renderCombinedEmail, type OutboxEmail } from './combined.js'

const item = (subject: string, tone: OutboxEmail['tone'], name: string): OutboxEmail => ({
  subject,
  tone,
  html: `<!doctype html><html><body><span style="display:none;">pre</span><p>${name}</p></body></html>`,
  text: `text-${name}`,
})

describe('renderCombinedEmail', () => {
  const items = [
    item('[emit-infra] 🟢 b recovered', 'recovered', 'b'),
    item('[emit-infra] 🔴 tastease DOWN — 502', 'critical', 'a'),
    item('[emit-infra] 🟠 martialops cert 6d', 'warning', 'c'),
  ]

  it('orders worst tone first and adopts it', () => {
    const r = renderCombinedEmail(items)
    expect(r.tone).toBe('critical')
    expect(r.html.indexOf('<p>a</p>')).toBeLessThan(r.html.indexOf('<p>c</p>'))
    expect(r.html.indexOf('<p>c</p>')).toBeLessThan(r.html.indexOf('<p>b</p>'))
    expect(r.html).not.toContain('display:none')
  })

  it('lists items in the subject', () => {
    expect(renderCombinedEmail(items).subject).toBe('[emit-infra] 🔴 3 alerts — tastease DOWN, martialops cert 6d, b recovered')
  })

  it('truncates a long subject', () => {
    const many = Array.from({ length: 20 }, (_, i) => item(`[emit-infra] 🔴 project-number-${i} DOWN`, 'critical', String(i)))
    const s = renderCombinedEmail(many).subject
    expect(s.length).toBeLessThanOrEqual(120)
    expect(s.endsWith('…')).toBe(true)
  })

  it('text contains every section', () => {
    const { text } = renderCombinedEmail(items)
    for (const n of ['a', 'b', 'c']) expect(text).toContain(`text-${n}`)
  })

  it('keeps each item\'s What to do steps', () => {
    const health = renderHealthEmail(healthDown)
    const r = renderCombinedEmail([{ ...health, tone: 'critical' }, item('[emit-infra] 🟠 x cert', 'warning', 'x')])
    expect(r.html).toContain('docker compose ps')
    expect(r.text).toContain('docker compose ps')
  })
})
