export type FetchErrorKind = 'unreachable' | 'not-configured' | 'error'

export type FetchResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: FetchErrorKind; message: string }

export const FETCH_ERROR_MESSAGES: Record<FetchErrorKind, string> = {
  unreachable: "Couldn't reach the server",
  'not-configured': 'Not configured for this project',
  error: 'Something went wrong',
}

function classify(status: number, errorBody: string | undefined): { kind: FetchErrorKind; message: string } {
  if (status === 503) return { kind: 'unreachable', message: FETCH_ERROR_MESSAGES.unreachable }
  if (status === 404 && errorBody && /not configured/i.test(errorBody)) {
    return { kind: 'not-configured', message: FETCH_ERROR_MESSAGES['not-configured'] }
  }
  return { kind: 'error', message: errorBody ?? FETCH_ERROR_MESSAGES.error }
}

export async function fetchResult<T>(fetchPromise: Promise<Response>): Promise<FetchResult<T>> {
  let res: Response
  try {
    res = await fetchPromise
  } catch {
    return { ok: false, kind: 'unreachable', message: FETCH_ERROR_MESSAGES.unreachable }
  }
  if (res.ok) return { ok: true, data: await res.json() as T }
  const body = await res.json().catch(() => undefined) as { error?: string } | undefined
  return { ok: false, ...classify(res.status, body?.error) }
}
