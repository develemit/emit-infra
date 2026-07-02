'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { getProjects, type ProjectSummary } from '@/lib/api'
import { SubPageShell } from '@/components/detail/sub-page-shell'
import { CronPanel } from '@/components/detail/cron-panel'
import { UfwPanel } from '@/components/detail/ufw-panel'
import { CostPanel } from '@/components/detail/cost-panel'
import { ProjectSettingsPanel } from '@/components/detail/project-settings-panel'

export default function AdminPage() {
  const params = useParams()
  const name = typeof params['name'] === 'string' ? decodeURIComponent(params['name']) : ''

  const [project, setProject] = useState<ProjectSummary | null>(null)

  useEffect(() => {
    getProjects().then(ps => setProject(ps.find(p => p.config.name === name) ?? null)).catch(() => {})
  }, [name])

  return (
    <SubPageShell name={name} title="Administration">
      <CronPanel name={name} />
      <UfwPanel name={name} />
      <CostPanel name={name} />
      {project && <ProjectSettingsPanel project={project} />}
    </SubPageShell>
  )
}
