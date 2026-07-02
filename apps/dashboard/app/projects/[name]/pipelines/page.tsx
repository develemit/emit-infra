'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { getProjects, getDeployCadence, type DeployCadenceDay, type ProjectSummary } from '@/lib/api'
import { useDeployMarkers } from '@/lib/use-deploy-markers'
import { useCiHistory } from '@/lib/use-ci-history'
import { SubPageShell } from '@/components/detail/sub-page-shell'
import { DeployCadenceChart } from '@/components/detail/deploy-cadence-chart'
import { DeployTimeline } from '@/components/detail/deploy-timeline'
import { CiTimeline } from '@/components/detail/ci-timeline'

export default function PipelinesPage() {
  const params = useParams()
  const name = typeof params['name'] === 'string' ? decodeURIComponent(params['name']) : ''

  const [cadenceDays, setCadenceDays] = useState<DeployCadenceDay[]>([])
  const [project, setProject] = useState<ProjectSummary | null>(null)
  const { deploys } = useDeployMarkers(name)
  const { runs: ciRuns } = useCiHistory(name)

  useEffect(() => {
    getDeployCadence(name).then(setCadenceDays).catch(() => {})
  }, [name])

  useEffect(() => {
    getProjects().then(ps => setProject(ps.find(p => p.config.name === name) ?? null)).catch(() => {})
  }, [name])

  const repoUrl = project?.config.github?.repo
    ? `https://github.com/${project.config.github.repo}/commit/`
    : undefined

  return (
    <SubPageShell name={name} title="Pipelines">
      <DeployCadenceChart days={cadenceDays} />
      <DeployTimeline deploys={deploys} name={name} repoUrl={repoUrl} />
      <CiTimeline runs={ciRuns} name={name} repoUrl={repoUrl} />
    </SubPageShell>
  )
}
