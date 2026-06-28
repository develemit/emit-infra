'use client'
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

interface Toast {
  id: number
  message: string
  type: 'success' | 'error'
}

interface ToastContextValue {
  showToast: (message: string, type: 'success' | 'error') => void
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} })

export function useToast() {
  return useContext(ToastContext)
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), 4000)
    return () => clearTimeout(t)
  }, [toast.id, onDismiss])

  const isSuccess = toast.type === 'success'
  return (
    <div
      className="flex items-center gap-2 px-4 py-3 rounded-xl text-[13px] font-medium shadow-lg"
      style={{
        background: isSuccess ? 'var(--ok-soft)' : 'var(--err-soft)',
        color: isSuccess ? 'var(--ok)' : 'var(--err)',
        border: `1px solid ${isSuccess ? 'var(--ok)' : 'var(--err)'}`,
        minWidth: 220,
      }}
    >
      <span className="text-[15px] leading-none">{isSuccess ? '✓' : '✗'}</span>
      {toast.message}
    </div>
  )
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const counter = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    const id = ++counter.current
    setToasts(prev => [...prev, { id, message, type }])
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 items-end pointer-events-none"
        style={{ maxWidth: 360 }}
      >
        {toasts.map(t => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}
