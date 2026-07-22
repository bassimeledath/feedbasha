import type { STTOptions, STTProvider } from '../types'
import { WebSpeechProvider } from './webspeech'

/**
 * Resolve an STT provider. The main bundle ships Web Speech only; a custom
 * backend (e.g. Whisper from `feedbasha/whisper`) can be passed as an instance
 * via `stt.provider`. Returns null when unavailable (session runs click-only).
 */
export async function createProvider(opts: STTOptions = {}): Promise<STTProvider | null> {
  const p = opts.provider ?? 'auto'

  // A caller-supplied provider instance (keeps heavy backends out of the core).
  if (typeof p === 'object' && p !== null) {
    return (await p.isAvailable()) ? p : null
  }

  // 'auto' and 'webspeech' both resolve to Web Speech here.
  const web = new WebSpeechProvider(opts.language ?? 'en-US')
  return (await web.isAvailable()) ? web : null
}
