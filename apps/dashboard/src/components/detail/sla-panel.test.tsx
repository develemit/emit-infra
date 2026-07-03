import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { SlaPanel } from './sla-panel'
import { slaColor } from './sla-panel-helpers'

describe('slaColor', () => {
  it('returns ok for 99.9 and above', () => {
    expect(slaColor(99.9)).toBe('var(--ok)')
    expect(slaColor(100)).toBe('var(--ok)')
  })

  it('returns warn for 99 to 99.9 exclusive', () => {
    expect(slaColor(99.0)).toBe('var(--warn)')
    expect(slaColor(99.5)).toBe('var(--warn)')
    expect(slaColor(99.89)).toBe('var(--warn)')
  })

  it('returns err for below 99', () => {
    expect(slaColor(98.99)).toBe('var(--err)')
    expect(slaColor(0)).toBe('var(--err)')
  })
})

describe('SlaPanel', () => {
  it('renders 7d and 30d uptime values', () => {
    render(<SlaPanel sla={{ uptime7d: 99.95, uptime30d: 99.80 }} />)
    expect(screen.getByText('99.95%')).toBeTruthy()
    expect(screen.getByText('99.80%')).toBeTruthy()
  })

  it('renders section labels', () => {
    render(<SlaPanel sla={{ uptime7d: 99.95, uptime30d: 99.80 }} />)
    expect(screen.getByText(/7-day uptime/i)).toBeTruthy()
    expect(screen.getByText(/30-day uptime/i)).toBeTruthy()
  })

  it('applies ok color to 99.9+ values', () => {
    render(<SlaPanel sla={{ uptime7d: 99.95, uptime30d: 98.0 }} />)
    const el = screen.getByText('99.95%')
    expect(el.style.color).toBe('var(--ok)')
  })

  it('applies warn color to 99–99.9 values', () => {
    render(<SlaPanel sla={{ uptime7d: 99.5, uptime30d: 99.95 }} />)
    const el = screen.getByText('99.50%')
    expect(el.style.color).toBe('var(--warn)')
  })

  it('applies err color to below-99 values', () => {
    render(<SlaPanel sla={{ uptime7d: 98.0, uptime30d: 99.95 }} />)
    const el = screen.getByText('98.00%')
    expect(el.style.color).toBe('var(--err)')
  })
})
