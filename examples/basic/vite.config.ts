import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// Import feedbasha straight from source for instant HMR (no build step).
const feedbashaSrc = fileURLToPath(new URL('../../src/index.ts', import.meta.url))
const feedbashaRoot = fileURLToPath(new URL('../../', import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { feedbasha: feedbashaSrc },
  },
  server: {
    // allow serving feedbasha's source + node_modules (react-grab) from above the example root
    fs: { allow: [feedbashaRoot] },
  },
})
