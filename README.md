# feedbasha

Dev-only, voice-first feedback capture for React web apps (works in the browser and in Electron). Click a floating mic, **talk while clicking the UI elements you're describing**, then get a chronological, paste-ready markdown log (what you said + which components you pointed at, with `file:line`) to drop into your coding agent. There's also a **text mode** (click an element, type a note).

> **Not published to npm.** Install from this repo or a local tarball only — never `npm install feedbasha` (that would pull an unrelated package). This is intentional.

## Install

```bash
npm install github:bassimeledath/feedbasha
```

Installing from git auto-builds via the `prepare` script. `react-grab` (for React component + `file:line` capture) comes as a dependency.

For **offline voice** (required in Electron; optional but private on the web) also install the peer dep:

```bash
npm install @huggingface/transformers
```

## Usage (web app)

Mount once, gated behind a dev flag — this is a development tool, don't ship it:

```ts
import { init } from 'feedbasha'

if (import.meta.env.DEV) {
  init({
    stt: { provider: 'auto' }, // Web Speech where available (Chrome), else click-only
    onCopy: (markdown) => console.log(markdown),
  })
}
```

Click the mic → talk + click elements (or switch to text mode) → **Review ▸** → **Copy feedback** → paste into your agent.

## Usage (Electron)

Web Speech is **disabled in Electron** (Chromium has no speech backend there), so use the offline **Whisper** provider in the renderer:

```ts
import { init } from 'feedbasha'
import { WhisperProvider } from 'feedbasha/whisper'

if (import.meta.env.DEV) {
  init({ stt: { provider: new WhisperProvider() } })
}
```

Two OS-level permission steps (Electron's job, not the widget's):

1. **Main process** — allow the mic:
   ```ts
   session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'media'))
   ```
2. **macOS** — add `NSMicrophoneUsageDescription` to the packaged app's `Info.plist`, or `getUserMedia` throws.

First run downloads the Whisper model once (cached after; works offline thereafter). On WebGPU it's fast with a live caption; on WASM it's slower with no interim caption, but finalized lines still appear in near-realtime.

## Configuration

`init(config)` accepts:

| Option | Default | Notes |
|---|---|---|
| `stt.provider` | `'auto'` | `'auto'` / `'webspeech'`, or an `STTProvider` instance (e.g. `new WhisperProvider()`). |
| `stt.language` | `'en-US'` | BCP-47 hint for Web Speech. |
| `position` | `'bottom-right'` | or `'bottom-left'`. |
| `dock` | `true` | Review panel yields (fades + click-through) when the cursor is over your app. |
| `onCopy(markdown, session)` | – | Called after copy; `markdown` is redacted, `session` is raw local data. |
| `redact(text)` | – | Scrub the assembled context before it's copied. |

Whisper (`feedbasha/whisper`) also takes `model`, `device` (`'auto'`/`'webgpu'`/`'wasm'`), and VAD tuning (`speechThreshold`, `silenceMs`, etc.).

## What it captures

The session is a chronological log of **speech** and **element selections** (with React component name + source `file:line`). Text-mode notes are attached explicitly to their element (`FEEDBACK on <Component> (file:line): "…"`). Everything is local; nothing is sent anywhere except your own `onCopy` handler and (for Web Speech) the browser's speech service.

## License

MIT
