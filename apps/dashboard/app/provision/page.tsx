'use client'
import { useState } from 'react'
import Link from 'next/link'
import { provisionProject } from '@/lib/api'
import { Icon } from '@/components/icon'
import { Stepper } from '@/components/ui/stepper'
import { MobileStepper } from '@/components/ui/mobile-stepper'
import { StepBasics } from '@/components/provision/step-basics'
import { StepInfrastructure } from '@/components/provision/step-infrastructure'
import { StepReview } from '@/components/provision/step-review'
import { StepRunning } from '@/components/provision/step-running'
import type { FormValues } from '@/components/provision/types'

const STEPS = ['Basics', 'Infrastructure', 'Review', 'Provision']
const SUBTITLES = [
  'Identify the project and where it lives.',
  'Pick the server size and optional resources.',
  'Confirm everything before anything is created.',
  'Terraform then Ansible — streaming live.',
]

const DEFAULT_VALUES: FormValues = {
  name: '', domain: '', githubRepo: '',
  region: 'nbg1', serverType: 'cx22', sshKey: 'emit-deploy',
  r2Buckets: [], redis: false,
}

export default function ProvisionPage() {
  const [step, setStep] = useState(1)
  const [values, setValues] = useState<FormValues>(DEFAULT_VALUES)
  const [errors, setErrors] = useState<Record<string, string>>({})

  function patch(p: Partial<FormValues>) {
    setValues(v => ({ ...v, ...p }))
  }

  const config = {
    name: values.name,
    domain: values.domain,
    github: { repo: values.githubRepo },
    region: values.region,
    serverType: values.serverType,
    sshKeyName: values.sshKey,
    ...(values.r2Buckets.length > 0 ? { r2: { buckets: values.r2Buckets } } : {}),
    ...(values.redis ? { upstash: { region: 'eu-central-1' } } : {}),
  }

  const { url: streamUrl, body: streamBody } = provisionProject(values.name || 'project', config)

  const stepBody =
    step === 1 ? <StepBasics values={values} onChange={patch} onNext={() => setStep(2)} errors={errors} setErrors={setErrors} />
    : step === 2 ? <StepInfrastructure values={values} onChange={patch} onNext={() => setStep(3)} onBack={() => setStep(1)} />
    : step === 3 ? <StepReview values={values} onNext={() => setStep(4)} onBack={() => setStep(2)} />
    : <StepRunning url={streamUrl} body={streamBody} name={values.name} />

  const isRunning = step === 4

  // Mobile nav footer
  function handleMobileNext() {
    if (step === 1) {
      const errs: Record<string, string> = {}
      if (!values.name || !/^[a-z0-9-]+$/.test(values.name)) errs['name'] = 'Invalid name'
      if (!values.domain || !values.domain.includes('.')) errs['domain'] = 'Invalid domain'
      if (!values.githubRepo || !/^[^/]+\/[^/]+$/.test(values.githubRepo)) errs['githubRepo'] = 'Must be owner/repo'
      if (Object.keys(errs).length > 0) { setErrors(errs); return }
      setErrors({})
      setStep(2)
    } else if (step === 2) {
      setStep(3)
    } else if (step === 3) {
      setStep(4)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Desktop topbar */}
      <div className="hidden lg:flex items-center gap-3 px-6 border-b border-border shrink-0" style={{ height: 56 }}>
        <Link href="/" className="text-subtle hover:text-fg transition-colors"><Icon name="arrowLeft" size={16} /></Link>
        <span className="text-[15px] font-semibold text-fg">New Project</span>
        <span className="text-[12px] font-mono text-subtle">Step {step} of 4</span>
      </div>

      {/* Mobile header */}
      <div className="lg:hidden flex items-center gap-2.5 px-4 border-b border-border shrink-0" style={{ height: 52 }}>
        <Link href="/" className="text-subtle"><Icon name="x" size={18} /></Link>
        <span className="text-[15px] font-semibold text-fg">New Project</span>
        <div className="flex-1" />
        <span className="text-[11.5px] font-mono text-subtle">{step}/4</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {/* Desktop: centered card with stepper */}
        <div className="hidden lg:block p-6">
          <div style={{ maxWidth: 600, margin: '0 auto' }}>
            <div className="mb-7 px-1"><Stepper steps={STEPS} current={step} /></div>
            <div className="rounded-2xl border border-border bg-card" style={{ padding: 24 }}>
              <div className="text-[17px] font-semibold text-fg mb-1">{STEPS[step - 1]}</div>
              <div className="text-[12.5px] text-muted mb-6">{SUBTITLES[step - 1]}</div>
              {stepBody}
            </div>
          </div>
        </div>

        {/* Mobile: full-width content with progress bars */}
        <div className="lg:hidden px-4 pb-[120px]">
          <div className="pt-4 mb-5"><MobileStepper steps={4} current={step} /></div>
          <div className="text-[18px] font-semibold text-fg mb-1">{STEPS[step - 1]}</div>
          <div className="text-[12.5px] text-muted mb-6">{SUBTITLES[step - 1]}</div>
          {stepBody}
        </div>
      </div>

      {/* Mobile sticky footer */}
      {!isRunning && (
        <div className="lg:hidden fixed bottom-16 left-0 right-0 z-40 flex gap-2 px-4 py-3 border-t border-border bg-elev">
          {step > 1 && (
            <button
              onClick={() => setStep(s => s - 1)}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-medium text-fg border border-border hover:bg-card-hover transition-colors"
            >
              <Icon name="arrowLeft" size={14} />Back
            </button>
          )}
          <button
            onClick={handleMobileNext}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-medium text-accent-fg bg-accent hover:opacity-90 transition-opacity"
          >
            {step === 3 ? <><Icon name="deploy" size={14} />Provision</> : <>Continue <Icon name="chevRight" size={14} /></>}
          </button>
        </div>
      )}
    </div>
  )
}
