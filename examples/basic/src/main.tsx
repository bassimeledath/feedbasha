import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { init } from 'feedbasha'
import html2canvas from 'html2canvas'
import './styles.css'

const root = document.getElementById('root')
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

// Mount Karen (dev-only). The technical package name remains `feedbasha` for compatibility.
init({
  stt: { provider: 'auto' },
  captureRegion: async (rect) => {
    // Browser-only best effort. Electron hosts should use webContents.capturePage.
    const canvas = await html2canvas(document.body, {
      x: window.scrollX + rect.x,
      y: window.scrollY + rect.y,
      width: rect.width,
      height: rect.height,
      scale: window.devicePixelRatio,
      useCORS: true,
      ignoreElements: (element) => element.hasAttribute('data-karen'),
    })
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    return blob ? { blob } : null
  },
  onCopy: (md) => console.log('[Karen] copied context:\n' + md),
})

// To test offline Whisper voice instead (works without Chrome, and in Electron):
//   1) npm install @huggingface/transformers   (in this examples/basic dir)
//   2) swap the init() above for:
// import { WhisperProvider } from 'feedbasha/whisper'
// init({
//   stt: { provider: new WhisperProvider() },      // downloads the model once, then caches
//   onCopy: (md) => console.log('[Karen] copied context:\n' + md),
// })
