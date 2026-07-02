'use client'
import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { getProjects, type ProjectSummary } from '@/lib/api'
import { useBackups } from '@/lib/use-backups'
import { SubPageShell } from '@/components/detail/sub-page-shell'
import { BackupPanel } from '@/components/detail/backup-panel'
import { SecretsPanel } from '@/components/detail/secrets-panel'

export default function DataPage() {
  const params = useParams()
  const name = typeof params['name'] === 'string' ? decodeURIComponent(params['name']) : ''

  const [project, setProject] = useState<ProjectSummary | null>(null)
  const backupsHook = useBackups(name)

  useEffect(() => {
    getProjects().then(ps => setProject(ps.find(p => p.config.name === name) ?? null)).catch(() => {})
  }, [name])

  return (
    <SubPageShell name={name} title="Data &amp; Secrets">
      {project?.config.postgres?.backupBucket && (
        <BackupPanel project={project} backups={backupsHook} />
      )}
      {project?.config.requiredEnvKeys != null && (
        <SecretsPanel name={name} />
      )}
    </SubPageShell>
  )
}
