import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React from 'react'
import { StepReview } from './step-review'
import type { FormValues } from './types'

vi.mock('@/components/icon', () => ({
  Icon: ({ name }: { name: string; size?: number; style?: React.CSSProperties }) =>
    React.createElement('span', { 'data-testid': `icon-${name}` }),
}))

const values: FormValues = {
  name: 'my-project',
  domain: 'app.example.com',
  githubRepo: 'owner/repo',
  region: 'nbg1',
  serverType: 'cx22',
  sshKey: 'emit-deploy',
  r2Buckets: [],
  redis: false,
  postgres: true,
  postgresBucket: '',
}

describe('StepReview', () => {
  it('does not truncate long values, letting them wrap instead', () => {
    render(<StepReview values={values} onNext={() => {}} onBack={() => {}} />)
    const postgresValue = screen.getByText('enabled · backup → (no bucket set)')
    expect(postgresValue.className).not.toContain('truncate')
    expect(postgresValue.className).toContain('break-words')
  })
})
