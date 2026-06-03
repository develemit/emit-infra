'use client'
import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { provisionProject } from '@/lib/api'
import { SseOutputPanel } from '@/components/sse-output-panel'
import { cn } from '@/lib/utils'

const REGIONS = ['nbg1', 'fsn1', 'hel1', 'ash', 'hil'] as const

const Step1Schema = z.object({
  name: z.string().min(1, 'Required').regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers, hyphens'),
  domain: z.string().min(1, 'Required'),
  githubRepo: z.string().regex(/^[^/]+\/[^/]+$/, 'Must be owner/repo format'),
})

const Step2Schema = z.object({
  region: z.enum(REGIONS),
  serverType: z.string().min(1, 'Required'),
  r2Buckets: z.string(),
  upstashRegion: z.string(),
})

type Step1 = z.infer<typeof Step1Schema>
type Step2 = z.infer<typeof Step2Schema>
type Errors = Record<string, string>

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1.5 text-gray-700 dark:text-gray-300">{label}</label>
      {children}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'w-full px-3 py-2 rounded-lg border text-sm',
        'border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800',
        props.className,
      )}
    />
  )
}

export default function ProvisionPage() {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [step1, setStep1] = useState<Step1>({ name: '', domain: '', githubRepo: '' })
  const [step2, setStep2] = useState<Step2>({ region: 'nbg1', serverType: 'cx22', r2Buckets: '', upstashRegion: '' })
  const [errors, setErrors] = useState<Errors>({})
  const [provisioning, setProvisioning] = useState(false)
  const [done, setDone] = useState(false)

  const validateStep1 = useCallback((): boolean => {
    const result = Step1Schema.safeParse(step1)
    if (!result.success) {
      const errs: Errors = {}
      result.error.issues.forEach((i) => { errs[i.path[0] as string] = i.message })
      setErrors(errs)
      return false
    }
    setErrors({})
    return true
  }, [step1])

  const validateStep2 = useCallback((): boolean => {
    const result = Step2Schema.safeParse(step2)
    if (!result.success) {
      const errs: Errors = {}
      result.error.issues.forEach((i) => { errs[i.path[0] as string] = i.message })
      setErrors(errs)
      return false
    }
    setErrors({})
    return true
  }, [step2])

  const config = {
    name: step1.name,
    domain: step1.domain,
    github: { repo: step1.githubRepo },
    region: step2.region,
    serverType: step2.serverType,
    ...(step2.r2Buckets ? { r2: { buckets: step2.r2Buckets.split(',').map((s) => s.trim()).filter(Boolean) } } : {}),
    ...(step2.upstashRegion ? { upstash: { region: step2.upstashRegion } } : {}),
  }

  const { url: streamUrl, body: streamBody } = provisionProject(step1.name, config)

  return (
    <div className="p-4 sm:p-6 max-w-lg">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-5">
        <ArrowLeft size={14} />
        Back
      </Link>

      <h1 className="text-2xl font-semibold mb-1">New Project</h1>
      <p className="text-sm text-gray-500 mb-6">Step {step} of 3</p>

      {step === 1 && (
        <div className="space-y-4">
          <Field label="Project name" error={errors['name']}>
            <Input value={step1.name} onChange={(e) => setStep1((s) => ({ ...s, name: e.target.value }))} placeholder="my-project" />
          </Field>
          <Field label="Domain" error={errors['domain']}>
            <Input value={step1.domain} onChange={(e) => setStep1((s) => ({ ...s, domain: e.target.value }))} placeholder="app.example.com" />
          </Field>
          <Field label="GitHub repo" error={errors['githubRepo']}>
            <Input value={step1.githubRepo} onChange={(e) => setStep1((s) => ({ ...s, githubRepo: e.target.value }))} placeholder="owner/repo" />
          </Field>
          <button onClick={() => validateStep1() && setStep(2)} className="w-full py-2.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium hover:opacity-90">
            Next
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <Field label="Region" error={errors['region']}>
            <select value={step2.region} onChange={(e) => setStep2((s) => ({ ...s, region: e.target.value as typeof REGIONS[number] }))} className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm">
              {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
          <Field label="Server type" error={errors['serverType']}>
            <Input value={step2.serverType} onChange={(e) => setStep2((s) => ({ ...s, serverType: e.target.value }))} placeholder="cx22" />
          </Field>
          <Field label="R2 buckets (comma-separated, optional)" error={errors['r2Buckets']}>
            <Input value={step2.r2Buckets} onChange={(e) => setStep2((s) => ({ ...s, r2Buckets: e.target.value }))} placeholder="uploads, backups" />
          </Field>
          <Field label="Upstash region (optional)" error={errors['upstashRegion']}>
            <Input value={step2.upstashRegion} onChange={(e) => setStep2((s) => ({ ...s, upstashRegion: e.target.value }))} placeholder="us-east-1" />
          </Field>
          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="flex-1 py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800">Back</button>
            <button onClick={() => validateStep2() && setStep(3)} className="flex-1 py-2.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium hover:opacity-90">Review</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4 text-sm space-y-1.5">
            <div className="flex justify-between"><span className="text-gray-500">Name</span><span className="font-mono">{step1.name}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Domain</span><span>{step1.domain}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Repo</span><span>{step1.githubRepo}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Region</span><span>{step2.region}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Server</span><span>{step2.serverType}</span></div>
          </div>

          {!provisioning && !done && (
            <div className="flex gap-2">
              <button onClick={() => setStep(2)} className="flex-1 py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800">Back</button>
              <button onClick={() => setProvisioning(true)} className="flex-1 py-2.5 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm font-medium hover:opacity-90">Provision</button>
            </div>
          )}

          {provisioning && (
            <SseOutputPanel url={streamUrl} method="POST" body={streamBody} active={!done} onComplete={() => setDone(true)} />
          )}

          {done && (
            <button onClick={() => router.push('/')} className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium">
              Done — view projects
            </button>
          )}
        </div>
      )}
    </div>
  )
}
