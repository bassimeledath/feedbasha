import type { STTOptions, STTProvider } from '../types'
import { WebSpeechProvider } from './webspeech'

/**
 * Resolve an STT provider. Thin-loop MVP ships Web Speech only.
 * Returns null when unavailable (session then runs click-only).
 */
export async function createProvider(opts: STTOptions = {}): Promise<STTProvider | null> {
  const web = new WebSpeechProvider(opts.language ?? 'en-US')
  return (await web.isAvailable()) ? web : null
}
