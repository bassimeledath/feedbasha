import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2020',
  // react-grab is a runtime dependency; keep it out of our bundle.
  external: ['react-grab', 'react-grab/*'],
})
