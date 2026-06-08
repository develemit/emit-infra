'use client'
export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 512 512"
        className="h-16 w-16 opacity-60"
        aria-hidden
      >
        <rect width="512" height="512" rx="115" fill="#10b981" />
        <path
          d="M299 64 141 256h117l-23 192 182-224H298z"
          fill="none"
          stroke="white"
          strokeWidth="28"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <h1 className="text-2xl font-semibold tracking-tight">You&apos;re offline</h1>
      <p className="max-w-xs text-sm text-zinc-400">
        Emit Infra needs a network connection to reach your infrastructure. Reconnect and reload to continue.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="mt-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 active:bg-emerald-700"
      >
        Try again
      </button>
    </div>
  )
}
