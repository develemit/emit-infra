// Pure formatting for a fatal (uncaughtException) crash — kept separate from
// the process.exit() call site so it's testable without actually crashing a
// process. See index.ts for why this exits while unhandledRejection does not.

export interface FatalErrorRecord {
  message: string
  stack: string | undefined
  raw: unknown
}

export function formatFatalError(err: unknown): FatalErrorRecord {
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack, raw: err }
  }
  return { message: String(err), stack: undefined, raw: err }
}
