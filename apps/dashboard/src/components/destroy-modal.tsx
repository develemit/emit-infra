'use client'
import { useState, useCallback } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SseOutputPanel } from './sse-output-panel'

interface Props {
  projectName: string
  apiBase: string
  onClose: () => void
}

export function DestroyModal({ projectName, apiBase, onClose }: Props) {
  const [step, setStep] = useState<'warning' | 'confirm' | 'running'>('warning')
  const [input, setInput] = useState('')
  const [done, setDone] = useState(false)

  const url = `${apiBase}/projects/${encodeURIComponent(projectName)}/destroy`
  const canConfirm = input === projectName

  const handleComplete = useCallback(() => setDone(true), [])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800">
          <h2 className="font-semibold text-red-600 dark:text-red-400">
            Destroy {projectName}
          </h2>
          {(step !== 'running' || done) && (
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <X size={18} />
            </button>
          )}
        </div>

        <div className="p-5 space-y-4">
          {step === 'warning' && (
            <>
              <p className="text-sm text-gray-700 dark:text-gray-300">
                This will run <strong>terraform destroy</strong> and permanently remove all
                infrastructure for <strong>{projectName}</strong> — servers, DNS records, and
                storage. This cannot be undone.
              </p>
              <button
                onClick={() => setStep('confirm')}
                className="w-full py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium"
              >
                I understand, continue
              </button>
            </>
          )}

          {step === 'confirm' && (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Type <strong className="text-gray-900 dark:text-gray-100">{projectName}</strong> to
                confirm:
              </p>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={projectName}
                autoFocus
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-mono"
              />
              <button
                onClick={() => canConfirm && setStep('running')}
                disabled={!canConfirm}
                className={cn(
                  'w-full py-2.5 rounded-lg text-sm font-medium transition-colors',
                  canConfirm
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed',
                )}
              >
                Destroy
              </button>
            </>
          )}

          {step === 'running' && (
            <>
              <SseOutputPanel url={url} method="POST" active={!done} onComplete={handleComplete} />
              {done && (
                <button
                  onClick={onClose}
                  className="w-full py-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium"
                >
                  Close
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
