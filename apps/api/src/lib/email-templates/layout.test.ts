import { describe, it, expect } from 'vitest'
import { renderLayout, truncateLines, MAX_PRE_LINES, TONE_COLOR, type LayoutInput } from './layout.js'
import { escapeHtml } from './escape.js'

const base: LayoutInput = {
  tone: 'critical',
  preheader: 'one-line preview',
  headline: 'Headline',
  summary: 'Summary text',
  facts: [['Project', 'tastease'], ['Cause', 'bad gateway']],
  actions: { buttons: [{ label: 'Open', url: 'http://x/y' }], run: ['emit-infra status tastease'] },
  footerNote: 'why sent',
  sentAtMs: Date.UTC(2026, 9, 6, 16, 0, 0),
}

describe('renderLayout', () => {
  it('uses the tone colour and carries the preheader', () => {
    const { html } = renderLayout(base)
    expect(html).toContain(TONE_COLOR.critical)
    expect(html).toContain('one-line preview')
    expect(renderLayout({ ...base, tone: 'recovered' }).html).toContain(TONE_COLOR.recovered)
  })

  it('renders facts as table rows and in the text version', () => {
    const { html, text } = renderLayout(base)
    expect(html).toContain('<tr><td')
    expect(html).toContain('bad gateway')
    expect(text).toContain('Project: tastease')
    expect(text).toContain('Cause: bad gateway')
    expect(text).toContain('Run: emit-infra status tastease')
    expect(text).toContain('Open: http://x/y')
  })

  it('shows the time in MST', () => {
    expect(renderLayout(base).html).toContain('09:00 MST')
  })

  it('truncates <pre> sections at the line cap', () => {
    const long = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
    const { html } = renderLayout({ ...base, sections: [{ title: 'Err', kind: 'pre', text: long }] })
    expect(html).toContain(`line ${MAX_PRE_LINES - 1}`)
    expect(html).not.toContain(`line ${MAX_PRE_LINES}<`)
    expect(html).toContain('…truncated')
    expect(truncateLines('a\nb')).toBe('a\nb')
  })

  it('caps buttons at 3', () => {
    const buttons = [1, 2, 3, 4].map((n) => ({ label: `B${n}`, url: `http://x/${n}` }))
    const { html } = renderLayout({ ...base, actions: { buttons } })
    expect(html).toContain('B3')
    expect(html).not.toContain('B4')
  })

  it('escapes script tags and quotes in every field', () => {
    const evil = `<script>alert("x")</script>'`
    const { html } = renderLayout({
      ...base,
      preheader: evil,
      headline: evil,
      summary: evil,
      facts: [[evil, evil]],
      sections: [
        { title: evil, kind: 'list', rows: [[evil, evil]] },
        { title: evil, kind: 'table', head: [evil], rows: [[evil], [{ text: evil, tint: 'red' }]] },
        { title: evil, kind: 'pre', text: evil },
      ],
      actions: { buttons: [{ label: evil, url: evil }], run: [evil] },
      footerNote: evil,
    })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('alert("x")')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('escapeHtml', () => {
  it('escapes the five dangerous characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })
})
