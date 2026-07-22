import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts', whisper: 'src/whisper.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2020',
  // Runtime deps kept out of our bundle; the host app resolves them.
  // @huggingface/transformers is only referenced from the `whisper` entry.
  external: ['react-grab', 'react-grab/*', '@huggingface/transformers'],
})
