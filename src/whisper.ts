// Opt-in offline STT backend. Kept out of the main entry so web apps that use
// the browser's Web Speech API never pull in @huggingface/transformers.
//
//   import { init } from 'feedbasha'
//   import { WhisperProvider } from 'feedbasha/whisper'
//   init({ stt: { provider: new WhisperProvider() } })
//
// Requires the host app to install `@huggingface/transformers`.
export { WhisperProvider } from './stt/whisper'
export type { WhisperOptions } from './stt/whisper'
