import { Icon } from '@/components/icon'
import type { FormValues } from './types'

interface Props {
  values: FormValues
  onChange: (patch: Partial<FormValues>) => void
  onNext: () => void
  errors: Record<string, string>
  setErrors: (e: Record<string, string>) => void
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[13px] font-medium text-fg">{label}</label>
      {children}
      {error && <span className="text-[11.5px] text-err">{error}</span>}
      {!error && hint && <span className="text-[11.5px] font-mono text-subtle">{hint}</span>}
    </div>
  )
}

function Input({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-3 py-2 rounded-lg text-[13px] font-mono text-fg bg-card border border-border focus:outline-none focus:border-accent transition-colors"
    />
  )
}

export function StepBasics({ values, onChange, onNext, errors, setErrors }: Props) {
  function validate() {
    const errs: Record<string, string> = {}
    if (!values.name) errs['name'] = 'Required'
    else if (!/^[a-z0-9-]+$/.test(values.name)) errs['name'] = 'Lowercase letters, numbers, hyphens only'
    if (!values.domain || !values.domain.includes('.')) errs['domain'] = 'Must be a valid domain'
    if (!values.githubRepo || !/^[^/]+\/[^/]+$/.test(values.githubRepo)) errs['githubRepo'] = 'Must be owner/repo format'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  return (
    <div className="flex flex-col gap-[18px]">
      <Field label="Project name" hint="lowercase, slug-format — becomes the directory & resource prefix" error={errors['name']}>
        <Input value={values.name} onChange={v => onChange({ name: v })} placeholder="my-project" />
      </Field>
      <Field label="Domain" hint="root domain managed in Cloudflare" error={errors['domain']}>
        <Input value={values.domain} onChange={v => onChange({ domain: v })} placeholder="app.example.com" />
      </Field>
      <Field label="GitHub repository" hint="owner/repo" error={errors['githubRepo']}>
        <div className="relative flex items-center">
          <span className="absolute left-3 text-subtle pointer-events-none"><Icon name="github" size={14} /></span>
          <input
            value={values.githubRepo}
            onChange={e => onChange({ githubRepo: e.target.value })}
            placeholder="owner/repo"
            className="w-full pl-9 pr-3 py-2 rounded-lg text-[13px] font-mono text-fg bg-card border border-border focus:outline-none focus:border-accent transition-colors"
          />
        </div>
      </Field>
      <button
        onClick={() => validate() && onNext()}
        className="hidden lg:flex w-full items-center justify-center gap-1.5 py-2.5 rounded-lg text-[13px] font-medium text-accent-fg bg-accent hover:opacity-90 transition-opacity"
      >
        Continue <Icon name="chevRight" size={14} />
      </button>
    </div>
  )
}
