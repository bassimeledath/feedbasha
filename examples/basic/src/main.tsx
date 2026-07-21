import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { init } from 'feedbasha'
import './styles.css'

const root = document.getElementById('root')
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

// Mount feedbasha (dev-only). Web Speech where available; falls back to click-only.
init({
  stt: { provider: 'auto' },
  onCopy: (md) => console.log('[feedbasha] copied context:\n' + md),
})
