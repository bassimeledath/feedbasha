# Bring Karen to your app

[← Back to Karen](README.md)

## React + Vite

Install from GitHub, not the npm package named `feedbasha`:

```bash
npm install 'github:bassimeledath/karen'
```

The installed package is still named `feedbasha`. For reproducible installs, append `#<commit-or-tag>` to the Git URL.

Add Karen's development-server plugin alongside your existing plugins in `vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { karen } from 'feedbasha/vite'

export default defineConfig({ plugins: [react(), karen()] })
```

Mount the overlay once from your app entry point, behind the development flag:

```ts
if (import.meta.env.DEV) {
  const { init } = await import('feedbasha')
  init()
}
```

Use Chrome for browser voice, or switch to text. Microphone capture starts only after you select a target. Speech transcripts remain editable.

## Region screenshots

The overlay collects component metadata by itself. To also capture images of dragged regions, install `html2canvas` and replace the initialization block above with:

```bash
npm install html2canvas
```

```ts
if (import.meta.env.DEV) {
  const { init } = await import('feedbasha')
  const { default: html2canvas } = await import('html2canvas')

  init({
    captureRegion: async (rect) => {
      const canvas = await html2canvas(document.body, {
        x: window.scrollX + rect.x,
        y: window.scrollY + rect.y,
        width: rect.width,
        height: rect.height,
        scale: window.devicePixelRatio,
        useCORS: true,
        ignoreElements: (el) => el.hasAttribute('data-karen'),
      })
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png'),
      )
      return blob ? { blob } : null
    },
  })
}
```

The Vite plugin saves PNGs under `.karen/captures/` when you copy feedback. Add `.karen/` to your app's `.gitignore`. Repeated copies reuse saved files; resetting the overlay doesn't delete them.

Copied Markdown includes absolute image paths. Your agent must be able to read those local files; copying doesn't upload screenshots to a cloud agent. If saving fails, **Copy text only** preserves your notes without image references.

Browser screenshots are best-effort: cross-origin images, video, canvas, and complex CSS can differ from screen pixels. Captures happen at selection time. PNGs are limited to 8 MB, and the Vite save endpoint only accepts same-origin localhost requests in development. Review images before sharing: text redaction does not redact screenshot pixels.

## Electron and offline voice

Electron hosts can use the same overlay, with Whisper for speech recognition:

```bash
npm install @huggingface/transformers@3.8.1
```

```ts
import { init } from 'feedbasha'
import { WhisperProvider } from 'feedbasha/whisper'

if (import.meta.env.DEV) {
  init({ stt: { provider: new WhisperProvider() } })
}
```

Whisper downloads its model on first use, then transcribes locally using the cached model. Use version **3.8.1** for this integration; newer runtimes need a separate compatibility check.

The host must grant microphone access to its trusted app renderer. On macOS, packaged apps also need `NSMicrophoneUsageDescription`. This is an integration, not a standalone Electron app; permissions and packaging remain the host's responsibility.

For native region screenshots, provide `captureRegion` using Electron's capture APIs and `saveCapture(blob)` through your host's IPC. Return a durable absolute path from `saveCapture`, or return `{ blob, reference }` from `captureRegion` if the image is already saved. Do not use temporary `blob:` URLs as handoff references.

## Options

| Option | Purpose |
| --- | --- |
| `stt.provider` | `'auto'` (browser speech) or a custom provider, such as `WhisperProvider`. |
| `stt.language` | Speech language; defaults to `'en-US'`. |
| `position` | `'bottom-right'` (default) or `'bottom-left'`. |
| `dock` | Lets Review yield when the pointer returns to the app; defaults to `true`. |
| `captureRegion(rect)` | Capture an image for a multi-component region. |
| `saveCapture(blob)` | Save an image and return a durable path; defaults to the local Vite endpoint. |
| `redact(text)` | Scrub the assembled Markdown before clipboard copy; does not alter images. |
| `onCopy(markdown, session)` | Receive redacted Markdown and the **raw, unredacted** session. |

`init()` returns `start()`, `stop()`, and `destroy()`. Await `start()` and `stop()`; `stop()` finalizes speech and opens Review. `destroy()` removes the overlay and releases resources. See [types](src/types.ts) for the full contract.

## Development

```bash
npm test
npm run typecheck
npm run build
```

The [example app](examples/basic) includes browser voice, region capture, and local image persistence.
