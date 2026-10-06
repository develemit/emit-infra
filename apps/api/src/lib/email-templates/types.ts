import type { Tone } from './layout.js'

export interface RenderedEmail {
  tone?: Tone
  subject: string
  html: string
  text: string
  /** First remediation step, appended to the push body so the notification is actionable. */
  firstStep?: string
}
