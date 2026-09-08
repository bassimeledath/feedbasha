# Karen

Karen is a development-only feedback overlay for React apps. Pick an element or drag a region, then attach one editable note by speaking or typing. Review the target, component metadata, and note together; copy the result as paste-ready Markdown for your coding agent.

The product is **Karen**. The technical import remains `feedbasha` for compatibility with existing integrations.

> Karen is not published to npm. Install this repository or a tagged release; `npm install feedbasha` refers to an unrelated package.

## Install

Pin a release or commit for reproducible installs:

```bash
npm install 'github:bassimeledath/feedbasha#<commit-or-tag>'
```

For offline voice in Electron, also install the optional peer dependency:

```bash
npm install @huggingface/transformers
```

## Vite / browser quickstart

During local development of Karen itself, install your local checkout with `npm install /absolute/path/to/karen`. The changes described here must be committed before a Git install can include them.

Add the small development-server integration to your host's `vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import { karen } from 'feedbasha/vite'

export default defineConfig({ plugins: [karen()] }) // alongside your existing plugins
```

Mount Karen once behind a development flag:

```ts
import { init } from 'feedbasha'

if (import.meta.env.DEV) {
  init({
    stt: { provider: 'auto' },
    onCopy: (markdown) => console.log(markdown),
  })
}
```

Use it in four steps:

1. Click the Karen launcher.
2. Click one component, or drag a region.
3. Speak or type in the editable note.
4. Choose **Review**, then **Copy feedback**.

Karen does not request microphone access until a target has been selected. After 60 seconds without speech, voice capture stops while preserving the same draft; choose **Resume** to continue on that target.

Press **Enter** to add a note or save an edit; **Shift+Enter** inserts a newline. Clicking the page outside the composer deselects it and keeps the most recent nonempty draft in memory. Use the toast's **Undo** action or select that same DOM element to restore it. Restoring never restarts the microphone automatically. Cancel/Escape discards the open draft. Native text undo is unchanged; drafts are cleared on reset or page reload.

Hover or focus a numbered pin to preview its target and note; click it during active capture to edit the existing annotation. Closing Review resumes capture. The elapsed-session timer is hidden in text mode.

## Region screenshots

Dragged regions retain their bounds and involved component metadata. Supply a screenshot callback that captures the original region when it is selected. For example, with `npm install html2canvas`:

```ts
import html2canvas from 'html2canvas'

init({
  captureRegion: async (rect) => {
    const canvas = await html2canvas(document.body, {
      x: scrollX + rect.x, y: scrollY + rect.y,
      width: rect.width, height: rect.height,
      scale: devicePixelRatio, useCORS: true,
      ignoreElements: (element) => element.hasAttribute('data-karen'),
    })
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    return blob ? { blob } : null
  },
})
```

The demo already includes both pieces. **Copy feedback saves the original PNGs first, then copies Markdown containing their absolute filesystem paths.** Files live under `.karen/captures/` in the Vite project root. Filenames are content hashes, so repeated copies reuse the same file. Add `.karen/` to the host project's `.gitignore`. Images stay on disk until you remove them; closing or resetting Karen does not break already-copied references.

This is a local coding-agent workflow: the agent must be able to read the same project filesystem. Copy does not put image pixels on the clipboard or upload them to a cloud agent. If saving fails, the notes stay intact and Karen offers **Copy text only**, with unattached screenshots identified in the Markdown. PNG uploads are limited to 8 MB; the endpoint accepts same-origin localhost requests during development only.

The core stays platform-neutral: Electron hosts can use native screenshot capture and supply `saveCapture(blob): Promise<string>` to persist images through IPC. Alternatively, `captureRegion` can return `{ blob, reference }` when a durable file is already saved. Browser `blob:` URLs are not durable references. Screenshot pixels are not processed by the text-only `redact` callback.

DOM rasterization is best-effort (cross-origin images, video, canvas, and complex CSS can differ from actual screen pixels). The crop is captured at selection time, never recaptured on Copy. Viewport/scroll information, selectors, source locations, and visible text accompany it. Region pins follow document scrolling but are invalidated after a lasting page mutation, viewport resize, or independently scrolling container movement. The original crop remains available in Review.

## Electron / offline voice

```ts
import { init } from 'feedbasha'
import { WhisperProvider } from 'feedbasha/whisper'

if (import.meta.env.DEV) {
  init({ stt: { provider: new WhisperProvider() } })
}
```

Electron must allow microphone permission in the main process:

```ts
session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
  callback(permission === 'media')
})
```

On macOS, the packaged app also needs `NSMicrophoneUsageDescription`. Whisper downloads its model on first use and then reuses the browser cache. The microphone is released whenever the draft is added, cancelled, or idled.

## Configuration

| Option | Default | Notes |
|---|---|---|
| `stt.provider` | `'auto'` | Web Speech, or a custom `STTProvider` such as `WhisperProvider`. |
| `stt.language` | `'en-US'` | BCP-47 language hint for Web Speech. |
| `position` | `'bottom-right'` | Also accepts `'bottom-left'`. |
| `dock` | `true` | Lets the review panel yield when the pointer returns to the app. |
| `captureRegion(rect)` | – | Optional screenshot adapter for multi-component regions. |
| `saveCapture(blob)` | Local Vite endpoint | Optional host-specific image persistence; returns a durable path. |
| `onCopy(markdown, session)` | – | Receives redacted Markdown and the raw local session. |
| `redact(text)` | – | Scrubs the assembled text before clipboard copy. |

## What Karen captures

Each review item is one annotation containing:

- the editable note and whether it came from voice or text;
- either one resolved element or one dragged region;
- React component, source location, DOM fallback, and visible text when available;
- optional screenshot data supplied by the host for regions.

Everything remains local except Web Speech audio, which follows the browser's speech service behavior, and callbacks supplied by the host application.

`start()` and `stop()` return promises. Await `stop()` when you need final transcription and Review to be ready. Voice owns one draft at a time: Pause releases capture, finalization drains pending speech in order, Cancel/Reset invalidate old callbacks, and Resume after an idle stop stays on the same draft. Provisional transcription appears in the editable textarea; user corrections are retained when final text arrives.

## Development

```bash
npm test
npm run typecheck
npm run build
npm run dev --prefix examples/basic
```

## License

MIT
