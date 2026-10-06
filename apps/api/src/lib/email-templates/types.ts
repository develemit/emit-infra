import type { Tone } from './layout.js'

export interface RenderedEmail {
  tone?: Tone
  subject: string
  html: string
  text: string
}
