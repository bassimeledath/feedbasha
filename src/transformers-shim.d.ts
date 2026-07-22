// Minimal ambient declaration so the `feedbasha/whisper` entry type-checks
// without installing the (large) @huggingface/transformers package here. The
// host app installs the real one; it's an optional peer dependency.
declare module '@huggingface/transformers' {
  export type Transcriber = (
    input: Float32Array,
    options?: Record<string, unknown>,
  ) => Promise<{ text?: string }>

  export function pipeline(
    task: string,
    model?: string,
    options?: Record<string, unknown>,
  ): Promise<Transcriber>
}
