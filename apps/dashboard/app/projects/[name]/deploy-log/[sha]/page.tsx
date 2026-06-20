'use client'
import { useParams } from 'next/navigation'
import { RunLogPage } from '@/components/detail/run-log-page'

export default function DeployLogPage() {
  const params = useParams()
  const name = typeof params['name'] === 'string' ? decodeURIComponent(params['name']) : ''
  const sha = typeof params['sha'] === 'string' ? params['sha'] : ''
  return <RunLogPage type="deploy" name={name} sha={sha} />
}
